import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { line, setupStoreSuite } from './storefrontHelpers.js';

const ctx = setupStoreSuite();

const callsOf = (method) => ctx.stripe.calls.filter((c) => c.method === method);
const lastSession = () => callsOf('checkout.sessions.create').at(-1).params;
const getOrder = (f, order) => ctx.call('GET', `/api/orders/${order.orderNumber}`, { cookie: f.cookie });
const orderCount = async () => (await ctx.row('SELECT COUNT(*) AS n FROM orders')).n;
const sessionTotal = (items) => items.reduce((sum, i) => sum + i.price_data.unit_amount * i.quantity, 0);

async function pendingOrder(quantity = 2) {
  const f = await ctx.orderFixture();
  const res = await ctx.placeOrder(f.cookie, [line(f.charm, quantity, [f.hook])], f.address);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ...f, order: res.body.order };
}

describe('placing an order opens a Stripe Checkout session', () => {
  test('201 with a pending order, the checkout url, reserved stock and no email', async () => {
    const f = await ctx.orderFixture();
    const res = await ctx.placeOrder(f.cookie, [line(f.charm, 1)], f.address);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.checkoutUrl, /^https:\/\/checkout\.stripe\.test\/cs_test_\w+$/);
    const o = res.body.order;
    assert.equal(o.status, 'pending_payment');
    assert.equal(o.taxRateBps, 975);
    assert.equal(o.taxCents, 98);
    assert.equal(o.totalCents, o.subtotalCents + o.shippingCents + o.taxCents);
    assert.equal(await ctx.stockOf('products', f.charm), 4);
    assert.equal(ctx.outbox.length, 0);
  });

  test('session params: payment mode, no Stripe Tax, product, shipping and tax lines summing to the total, expiry, urls', async () => {
    const f = await ctx.orderFixture();
    await ctx.setSettings(f.admin, { shippingEnabled: true });
    await ctx.addRate(f.admin, { countryCode: 'US', priceCents: 500 });
    const before = Math.floor(Date.now() / 1000);
    const { order } = (await ctx.placeOrder(f.cookie, [line(f.charm, 2, [f.hook])], f.address)).body;
    const after = Math.floor(Date.now() / 1000);

    const p = lastSession();
    assert.equal(p.mode, 'payment');
    assert.ok(p.customer);
    assert.equal('automatic_tax' in p, false);
    assert.equal('payment_method_types' in p, false);
    assert.ok(p.expires_at >= before + 30 * 60);
    assert.ok(p.expires_at <= after + 32 * 60);
    assert.ok(p.success_url.endsWith(`/orders/${order.orderNumber}?paid=1`), p.success_url);
    assert.ok(p.cancel_url.endsWith('/checkout'), p.cancel_url);
    assert.doesNotMatch(JSON.stringify(p.line_items), /tax_behavior|tax_code/);

    assert.equal(p.line_items.length, 3);
    for (const item of p.line_items) assert.equal(item.price_data.currency, 'usd');
    const [goods, shipping, tax] = p.line_items;
    assert.equal(goods.price_data.unit_amount, 1200);
    assert.equal(goods.quantity, 2);
    assert.equal(shipping.price_data.product_data.name, 'Shipping');
    assert.equal(shipping.price_data.unit_amount, 500);
    assert.equal(tax.price_data.product_data.name, 'Tax (9.75%)');
    assert.equal(tax.price_data.unit_amount, 234);
    assert.equal(tax.quantity, 1);
    assert.equal(sessionTotal(p.line_items), order.totalCents);
  });

  test('no shipping line when shipping is off; the tax line follows the products', async () => {
    const f = await ctx.orderFixture();
    const { order } = (await ctx.placeOrder(f.cookie, [line(f.charm, 1, [f.hook])], f.address)).body;
    const { line_items: items } = lastSession();
    assert.deepEqual(items.map((i) => i.price_data.product_data.name).slice(1), ['Tax (9.75%)']);
    assert.equal(sessionTotal(items), order.totalCents);
  });

  test('first order creates the Stripe customer from the saved address; the next order reuses it', async () => {
    const f = await ctx.orderFixture();
    await ctx.placeOrder(f.cookie, [line(f.charm)], f.address);

    const creates = callsOf('customers.create');
    assert.equal(creates.length, 1);
    assert.equal(creates[0].params.email, 'ada@example.com');
    assert.deepEqual(
      ['line1', 'city', 'state', 'postal_code', 'country'].map((k) => creates[0].params.shipping.address[k]),
      ['1 Main St', 'Los Angeles', 'CA', '90001', 'US'],
    );
    const firstCustomer = lastSession().customer;

    await ctx.placeOrder(f.cookie, [line(f.charm)], f.address);
    assert.equal(callsOf('customers.create').length, 1);
    assert.equal(callsOf('customers.update').length, 1);
    assert.equal(lastSession().customer, firstCustomer);
  });

  test('a Stripe failure is 502 and leaves no order and no reserved stock', async () => {
    const f = await ctx.orderFixture();
    ctx.stripe.failNext = true;
    const res = await ctx.placeOrder(f.cookie, [line(f.charm, 2, [f.hook])], f.address);
    assert.equal(res.status, 502);
    assert.equal(await orderCount(), 0);
    assert.equal(await ctx.stockOf('products', f.charm), 5);
    assert.equal(await ctx.stockOf('accessories', f.hook), 10);
  });
});

describe('a new order replaces the same user\'s unpaid orders', () => {
  test('earlier pending orders are expired at Stripe, deleted, and their stock restored', async () => {
    const f = await pendingOrder(2);
    assert.equal(await ctx.stockOf('accessories', f.hook), 8);

    const next = await ctx.placeOrder(f.cookie, [line(f.charm, 1)], f.address);
    assert.equal(next.status, 201, JSON.stringify(next.body));
    assert.equal(callsOf('checkout.sessions.expire').length, 1);
    assert.equal((await getOrder(f, f.order)).status, 404);
    assert.equal(await orderCount(), 1);
    assert.equal(await ctx.stockOf('products', f.charm), 4);
    assert.equal(await ctx.stockOf('accessories', f.hook), 10);
  });

  test('paid orders and other users\' pending orders are left alone', async () => {
    const f = await ctx.orderFixture();
    const other = await ctx.userWithAddress('eve@example.com');
    const paid = await ctx.placePaid(f.cookie, [line(f.charm)], f.address);
    const theirs = (await ctx.placeOrder(other.cookie, [line(f.charm)], other.address)).body.order;
    ctx.stripe.calls.length = 0;

    assert.equal((await ctx.placeOrder(f.cookie, [line(f.charm)], f.address)).status, 201);
    assert.equal(callsOf('checkout.sessions.expire').length, 0);
    assert.equal((await getOrder(f, paid)).body.order.status, 'placed');
    assert.equal((await ctx.call('GET', `/api/orders/${theirs.orderNumber}`, { cookie: other.cookie })).status, 200);
  });
});

describe('stripe webhook', () => {
  test('a missing or invalid signature is 400 and changes nothing', async () => {
    const f = await pendingOrder();
    const event = ctx.sessionEvent('checkout.session.completed', f.order);
    assert.equal(await ctx.postWebhook(event, { signature: null }), 400);
    assert.equal(await ctx.postWebhook(event, { signature: 't=1,v1=deadbeef' }), 400);
    assert.equal((await getOrder(f, f.order)).body.order.status, 'pending_payment');
    assert.equal(ctx.outbox.length, 0);
  });

  test('completed + paid places the order, keeps tax and total as computed, and emails once', async () => {
    const f = await pendingOrder();
    const event = ctx.sessionEvent('checkout.session.completed', f.order, { taxCents: f.order.taxCents + 123 });
    assert.equal(await ctx.postWebhook(event), 200);

    const paid = (await getOrder(f, f.order)).body.order;
    assert.equal(paid.status, 'placed');
    assert.equal(paid.taxCents, f.order.taxCents);
    assert.equal(paid.totalCents, f.order.totalCents);
    assert.equal(ctx.outbox.length, 1);
    assert.equal(ctx.outbox[0].to, 'ada@example.com');
    assert.doesNotMatch(ctx.outbox[0].text, /payment instructions/i);

    assert.equal(await ctx.postWebhook(event), 200);
    assert.equal(ctx.outbox.length, 1);
    assert.deepEqual((await getOrder(f, f.order)).body.order, paid);
  });

  test('completed + unpaid keeps the order pending and sends nothing', async () => {
    const f = await pendingOrder();
    const event = ctx.sessionEvent('checkout.session.completed', f.order, { paymentStatus: 'unpaid' });
    assert.equal(await ctx.postWebhook(event), 200);
    assert.equal((await getOrder(f, f.order)).body.order.status, 'pending_payment');
    assert.equal(ctx.outbox.length, 0);
  });

  test('async_payment_succeeded places the order like a paid completion', async () => {
    const f = await pendingOrder();
    const event = ctx.sessionEvent('checkout.session.async_payment_succeeded', f.order);
    assert.equal(await ctx.postWebhook(event), 200);
    const paid = (await getOrder(f, f.order)).body.order;
    assert.equal(paid.status, 'placed');
    assert.equal(paid.totalCents, f.order.totalCents);
    assert.equal(ctx.outbox.length, 1);
  });

  for (const type of ['checkout.session.expired', 'checkout.session.async_payment_failed']) {
    test(`${type} deletes the order and restores stock`, async () => {
      const f = await pendingOrder(3);
      assert.equal(await ctx.postWebhook(ctx.sessionEvent(type, f.order, { paymentStatus: 'unpaid' })), 200);
      assert.equal((await getOrder(f, f.order)).status, 404);
      assert.equal(await ctx.stockOf('products', f.charm), 5);
      assert.equal(await ctx.stockOf('accessories', f.hook), 10);
    });
  }

  test('an unknown event type or session id is acknowledged without changes', async () => {
    const f = await pendingOrder(2);
    assert.equal(await ctx.postWebhook(ctx.sessionEvent('payment_intent.created', f.order)), 200);
    assert.equal(await ctx.postWebhook(ctx.sessionEvent('checkout.session.completed', f.order, { sessionId: 'cs_test_unknown' })), 200);
    assert.equal(await ctx.postWebhook(ctx.sessionEvent('checkout.session.expired', f.order, { sessionId: 'cs_test_unknown' })), 200);
    assert.equal((await getOrder(f, f.order)).body.order.status, 'pending_payment');
    assert.equal(await ctx.stockOf('products', f.charm), 3);
    assert.equal(ctx.outbox.length, 0);
  });
});
