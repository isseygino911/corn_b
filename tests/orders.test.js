import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { line, setupStoreSuite, UNKNOWN_UUID } from './storefrontHelpers.js';

const ctx = setupStoreSuite();

const fixture = () => ctx.orderFixture();
const myOrders = (cookie) => ctx.call('GET', '/api/orders', { cookie });
const counts = async () => ({
  orders: (await ctx.row('SELECT COUNT(*) AS n FROM orders')).n,
  items: (await ctx.row('SELECT COUNT(*) AS n FROM order_items')).n,
});

describe('place order', () => {
  test('401 signed out', async () => {
    assert.equal((await ctx.call('POST', '/api/orders', { body: {} })).status, 401);
    assert.equal((await ctx.call('GET', '/api/orders')).status, 401);
    assert.equal((await ctx.call('GET', '/api/orders/GGF-000001')).status, 401);
  });

  test('201 with a repriced pending_payment order: snapshots, flat 9.75% tax on the subtotal, number format', async () => {
    const { admin, hook, charm, cookie, address } = await fixture();
    await ctx.setSettings(admin, { shippingEnabled: true });
    await ctx.addRate(admin, { countryCode: 'US', priceCents: 500 });

    const res = await ctx.placeOrder(cookie, [line(charm, 2, [hook])], address, { totalCents: 1, subtotalCents: 1, taxCents: 7 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.checkoutUrl);
    const o = res.body.order;
    assert.match(o.orderNumber, /^GGF-\d{6}$/);
    assert.match(o.publicId, /^[0-9a-f-]{36}$/);
    assert.equal(o.status, 'pending_payment');
    assert.equal(o.email, 'ada@example.com');
    assert.equal(o.subtotalCents, 2400); // (1000 + 200) x 2
    assert.equal(o.shippingCents, 500);
    assert.equal(o.taxRateBps, 975);
    assert.equal(o.taxCents, 234); // 2400 x 9.75%, shipping untaxed
    assert.equal(o.totalCents, 2400 + 500 + 234);
    assert.ok(o.placedAt && o.statusUpdatedAt);
    assert.deepEqual(o.address, {
      fullName: 'Ada Lovelace',
      phone: '555-0100',
      line1: '1 Main St',
      line2: null,
      countryCode: 'US',
      stateCode: 'CA',
      city: 'Los Angeles',
      postalCode: '90001',
    });
    assert.equal(o.items.length, 1);
    const [item] = o.items;
    assert.equal(item.sku, charm.sku);
    assert.equal(item.name, 'Charm');
    assert.equal(item.unitCents, 1000);
    assert.equal(item.quantity, 2);
    assert.equal(item.lineCents, 2400);
    assert.deepEqual(item.accessories, [{ sku: hook.sku, name: 'Hook', unitCents: 200 }]);
  });

  test('shipping comes from the saved address country, falling back to the default row', async () => {
    const { admin, charm } = await fixture();
    await ctx.setSettings(admin, { shippingEnabled: true });
    await ctx.addRate(admin, { countryCode: 'US', priceCents: 500 });
    await ctx.addRate(admin, { priceCents: 1500 });
    const uk = await ctx.userWithAddress('uk@example.com', { countryCode: 'GB', stateCode: 'ENG', city: 'London', postalCode: 'SW1A 1AA' });
    const res = await ctx.placeOrder(uk.cookie, [line(charm)], uk.address);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.order.shippingCents, 1500);
  });

  test('rejects the order when shipping is on and the country has no rate', async () => {
    const { admin, charm, cookie, address } = await fixture();
    await ctx.setSettings(admin, { shippingEnabled: true });
    const res = await ctx.placeOrder(cookie, [line(charm)], address);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /ship there/i);
    assert.deepEqual(await counts(), { orders: 0, items: 0 });
    assert.equal(await ctx.stockOf('products', charm), 5);
  });

  test('decrements product and accessory stock by the quantity ordered', async () => {
    const { hook, charm, cookie, address } = await fixture();
    assert.equal((await ctx.placeOrder(cookie, [line(charm, 3, [hook])], address)).status, 201);
    assert.equal(await ctx.stockOf('products', charm), 2);
    assert.equal(await ctx.stockOf('accessories', hook), 7);
  });

  test('buying exactly the remaining stock succeeds, then the next order is 409', async () => {
    const { charm, cookie, address } = await fixture();
    await ctx.placePaid(cookie, [line(charm, 5)], address);
    assert.equal(await ctx.stockOf('products', charm), 0);
    assert.equal((await ctx.placeOrder(cookie, [line(charm, 1)], address)).status, 409);
  });

  test('over-stock is 409 naming the item; nothing is created or decremented', async () => {
    const { hook, charm, cookie, address } = await fixture();
    const res = await ctx.placeOrder(cookie, [line(charm, 6, [hook])], address);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Charm/);
    assert.deepEqual(await counts(), { orders: 0, items: 0 });
    assert.equal(await ctx.stockOf('products', charm), 5);
    assert.equal(await ctx.stockOf('accessories', hook), 10);
  });

  test('over-stock on an accessory is 409 naming the accessory', async () => {
    const { admin, charm, cookie, address } = await fixture();
    const scarce = await ctx.makeAccessory(admin, { name: 'Scarce', stock: 1 });
    await ctx.call('PATCH', `/api/admin/products/${charm.id}`, { cookie: admin, body: { accessoryIds: [scarce.publicId] } });
    const res = await ctx.placeOrder(cookie, [line(charm, 2, [scarce])], address);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Scarce/);
    assert.equal(await ctx.stockOf('products', charm), 5);
  });

  test('is atomic: a failing second line rolls back the first line\'s stock and rows', async () => {
    const { admin, hook, charm, cookie, address } = await fixture();
    const pearl = await ctx.makeProduct(admin, { name: 'Pearl', stock: 1 });
    const res = await ctx.placeOrder(cookie, [line(charm, 2, [hook]), line(pearl, 2)], address);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Pearl/);
    assert.deepEqual(await counts(), { orders: 0, items: 0 });
    assert.equal(await ctx.stockOf('products', charm), 5);
    assert.equal(await ctx.stockOf('accessories', hook), 10);
    assert.equal(await ctx.stockOf('products', pearl), 1);
  });

  test('rejects inactive, archived and unknown products', async () => {
    const { admin, charm, cookie, address } = await fixture();
    const off = await ctx.makeProduct(admin, { name: 'Off', active: false });
    const gone = await ctx.makeProduct(admin, { name: 'Gone' });
    await ctx.call('POST', `/api/admin/products/${gone.id}/archive`, { cookie: admin });
    assert.equal((await ctx.placeOrder(cookie, [line(off)], address)).status, 404);
    assert.equal((await ctx.placeOrder(cookie, [line(gone)], address)).status, 404);
    assert.equal((await ctx.placeOrder(cookie, [{ slug: 'nope', accessoryIds: [], quantity: 1 }], address)).status, 404);
    assert.equal((await ctx.placeOrder(cookie, [line(charm), line(off)], address)).status, 404);
    assert.deepEqual(await counts(), { orders: 0, items: 0 });
    assert.equal(await ctx.stockOf('products', charm), 5);
  });

  test('rejects inactive, archived, sold-out, not-allowed and unknown accessories with 400', async () => {
    const { admin, charm, cookie, address } = await fixture();
    const inactive = await ctx.makeAccessory(admin, { name: 'I' });
    const archived = await ctx.makeAccessory(admin, { name: 'R' });
    const soldOut = await ctx.makeAccessory(admin, { name: 'S', stock: 0 });
    const stranger = await ctx.makeAccessory(admin, { name: 'N' });
    const linked = await ctx.makeProduct(admin, {
      name: 'Linked',
      accessoryIds: [inactive.publicId, archived.publicId, soldOut.publicId],
    });
    await ctx.call('PATCH', `/api/admin/accessories/${inactive.id}`, { cookie: admin, body: { active: false } });
    await ctx.call('POST', `/api/admin/accessories/${archived.id}/archive`, { cookie: admin });

    for (const a of [inactive, archived, soldOut]) {
      assert.equal((await ctx.placeOrder(cookie, [line(linked, 1, [a])], address)).status, 400, a.name);
    }
    assert.equal((await ctx.placeOrder(cookie, [line(charm, 1, [stranger])], address)).status, 400, 'not allowed');
    assert.equal((await ctx.placeOrder(cookie, [{ slug: charm.slug, accessoryIds: [UNKNOWN_UUID], quantity: 1 }], address)).status, 400, 'unknown');
    assert.deepEqual(await counts(), { orders: 0, items: 0 });
  });

  test('400 for empty items, bad quantity or a missing address; 404 for another user\'s or an unknown address', async () => {
    const { charm, cookie, address } = await fixture();
    const other = await ctx.userWithAddress('eve@example.com');
    assert.equal((await ctx.placeOrder(cookie, [], address)).status, 400);
    assert.equal((await ctx.placeOrder(cookie, [line(charm, 0)], address)).status, 400);
    assert.equal((await ctx.placeOrder(cookie, [line(charm, 1.5)], address)).status, 400);
    assert.equal((await ctx.call('POST', '/api/orders', { cookie, body: { items: [line(charm)] } })).status, 400);
    assert.equal((await ctx.placeOrder(cookie, [line(charm)], other.address)).status, 404);
    assert.equal((await ctx.placeOrder(cookie, [line(charm)], { id: 999999 })).status, 404);
    assert.deepEqual(await counts(), { orders: 0, items: 0 });
  });

  test('later price edits, archiving and address edits never change a placed order', async () => {
    const { admin, hook, charm, cookie, address } = await fixture();
    const placed = (await ctx.placeOrder(cookie, [line(charm, 1, [hook])], address)).body.order;

    await ctx.call('PATCH', `/api/admin/products/${charm.id}`, { cookie: admin, body: { priceCents: 9999, name: 'Renamed' } });
    await ctx.call('POST', `/api/admin/accessories/${hook.id}/archive`, { cookie: admin });
    await ctx.call('POST', `/api/admin/products/${charm.id}/archive`, { cookie: admin });
    await ctx.call('PATCH', `/api/account/addresses/${address.id}`, { cookie, body: { line1: '99 Other Rd' } });

    const res = await ctx.call('GET', `/api/orders/${placed.orderNumber}`, { cookie });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.order, placed);
  });

  test('order numbers are unique and increase', async () => {
    const { charm, cookie, address } = await fixture();
    const a = (await ctx.placePaid(cookie, [line(charm)], address)).orderNumber;
    const b = (await ctx.placeOrder(cookie, [line(charm)], address)).body.order.orderNumber;
    assert.notEqual(a, b);
    assert.ok(b > a);
  });
});

describe('order confirmation email', () => {
  test('nothing is sent when the order is placed', async () => {
    const { hook, charm, cookie, address } = await fixture();
    assert.equal((await ctx.placeOrder(cookie, [line(charm, 1, [hook])], address)).status, 201);
    assert.equal(ctx.outbox.length, 0);
  });

  test('is sent to the customer once paid with order number, items, totals, tax and link', async () => {
    const { hook, charm, cookie, address } = await fixture();
    const { order } = (await ctx.placeOrder(cookie, [line(charm, 1, [hook])], address)).body;
    await ctx.payOrder(order);

    assert.equal(ctx.outbox.length, 1);
    const [mail] = ctx.outbox;
    assert.equal(mail.to, 'ada@example.com');
    assert.match(mail.subject, new RegExp(order.orderNumber));
    for (const part of [mail.text, mail.html]) {
      assert.ok(part, 'has both text and html');
      for (const expected of [order.orderNumber, 'Charm', 'Hook', '1 Main St', `/orders/${order.orderNumber}`, 'Tax (9.75%)']) {
        assert.ok(part.includes(expected), `missing ${expected}`);
      }
      assert.doesNotMatch(part, /payment instructions/i);
    }
    assert.ok(mail.text.includes(`${process.env.APP_URL}/orders/${order.orderNumber}`));
    assert.ok(mail.text.includes('12.00'), 'subtotal shown');
  });

  test('no email is sent when the order is rejected', async () => {
    const { charm, cookie, address } = await fixture();
    assert.equal((await ctx.placeOrder(cookie, [line(charm, 6)], address)).status, 409);
    assert.equal(ctx.outbox.length, 0);
  });

  test('a send failure does not fail the payment', async () => {
    const { charm, cookie, address } = await fixture();
    const { order } = (await ctx.placeOrder(cookie, [line(charm)], address)).body;
    ctx.outbox.push = () => {
      throw new Error('smtp down');
    };
    try {
      await ctx.payOrder(order);
      const res = await ctx.call('GET', `/api/orders/${order.orderNumber}`, { cookie });
      assert.equal(res.body.order.status, 'placed');
      assert.equal(await ctx.stockOf('products', charm), 4);
    } finally {
      delete ctx.outbox.push;
    }
  });
});

describe('own orders', () => {
  test('list is newest first and only the caller\'s', async () => {
    const { charm, cookie, address } = await fixture();
    const other = await ctx.userWithAddress('eve@example.com');
    const first = await ctx.placePaid(cookie, [line(charm)], address);
    const second = await ctx.placePaid(cookie, [line(charm, 2)], address);
    await ctx.placeOrder(other.cookie, [line(charm)], other.address);

    const res = await myOrders(cookie);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.orders.map((o) => o.orderNumber), [second.orderNumber, first.orderNumber]);
    assert.equal(res.body.orders[0].totalCents, second.totalCents);
    assert.equal(res.body.orders[0].status, 'placed');
    assert.equal((await myOrders(other.cookie)).body.orders.length, 1);
  });

  test('empty list for a user with no orders', async () => {
    const cookie = await ctx.cookieFor('new@example.com');
    assert.deepEqual((await myOrders(cookie)).body, { orders: [] });
  });

  test('detail by orderNumber returns the full order; another user\'s or an unknown number is 404', async () => {
    const { charm, cookie, address } = await fixture();
    const other = await ctx.cookieFor('eve@example.com');
    const { order } = (await ctx.placeOrder(cookie, [line(charm)], address)).body;

    const mine = await ctx.call('GET', `/api/orders/${order.orderNumber}`, { cookie });
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.order, order);
    assert.equal((await ctx.call('GET', `/api/orders/${order.orderNumber}`, { cookie: other })).status, 404);
    assert.equal((await ctx.call('GET', '/api/orders/GGF-999999', { cookie })).status, 404);
  });

  test('customer responses never expose the numeric id or userId', async () => {
    const { charm, cookie, address } = await fixture();
    const placed = (await ctx.placeOrder(cookie, [line(charm)], address)).body.order;
    const [listed] = (await myOrders(cookie)).body.orders;
    const detail = (await ctx.call('GET', `/api/orders/${placed.orderNumber}`, { cookie })).body.order;
    for (const order of [placed, listed, detail]) {
      assert.equal('id' in order, false);
      assert.equal('userId' in order, false);
    }
  });
});

describe('order quantity cap', () => {
  test('more than 10 per line is 400 even with enough stock, and 10 is accepted', async () => {
    const { admin, cookie, address } = await fixture();
    const plenty = await ctx.makeProduct(admin, { name: 'Plenty', stock: 50 });
    assert.equal((await ctx.placeOrder(cookie, [line(plenty, 11)], address)).status, 400);
    assert.deepEqual(await counts(), { orders: 0, items: 0 });
    assert.equal(await ctx.stockOf('products', plenty), 50);
    assert.equal((await ctx.placeOrder(cookie, [line(plenty, 10)], address)).status, 201);
    assert.equal(await ctx.stockOf('products', plenty), 40);
  });
});
