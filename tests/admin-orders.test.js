import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { line, setupStoreSuite } from './storefrontHelpers.js';

const ctx = setupStoreSuite();

const ADMIN_ROUTES = [
  ['GET', '/api/admin/orders'],
  ['GET', '/api/admin/orders/1'],
  ['PATCH', '/api/admin/orders/1/status'],
];

const fixture = () => ctx.orderFixture();

// A paid (status placed) order as the customer sees it.
const place = (f, quantity = 2) => ctx.placePaid(f.cookie, [line(f.charm, quantity, [f.hook])], f.address);
const setStatus = (admin, order, status) =>
  ctx.call('PATCH', `/api/admin/orders/${order.id}/status`, { cookie: admin, body: { status } });
const listOrders = (admin, query = '') => ctx.call('GET', `/api/admin/orders${query}`, { cookie: admin });
// The numeric id is only exposed to admins; look it up from the list.
const withId = async (admin, order) => {
  const found = (await listOrders(admin)).body.orders.find((o) => o.orderNumber === order.orderNumber);
  return { ...order, id: found.id };
};

describe('admin orders auth', () => {
  for (const [method, path] of ADMIN_ROUTES) {
    test(`${method} ${path} is 401 signed out and 403 for a non-admin`, async () => {
      const body = method === 'GET' ? undefined : { status: 'shipped' };
      assert.equal((await ctx.call(method, path, { body })).status, 401);
      const cookie = await ctx.cookieFor('user@example.com');
      assert.equal((await ctx.call(method, path, { cookie, body })).status, 403);
    });
  }
});

describe('admin order list and detail', () => {
  test('list is paginated newest first with the row shape, across all customers', async () => {
    const f = await fixture();
    const other = await ctx.userWithAddress('eve@example.com');
    const first = await place(f, 1);
    const second = await ctx.placePaid(other.cookie, [line(f.charm)], other.address);

    const res = await listOrders(f.admin);
    assert.equal(res.status, 200);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.pageSize, 25);
    assert.equal(res.body.total, 2);
    assert.deepEqual(res.body.orders.map((o) => o.orderNumber), [second.orderNumber, first.orderNumber]);
    const [row] = res.body.orders;
    assert.equal(typeof row.id, 'number');
    assert.equal(row.email, 'eve@example.com');
    assert.equal(row.status, 'placed');
    assert.equal(row.totalCents, second.totalCents);
    assert.ok(row.placedAt);
  });

  test('pages of 25: page 2 holds the remainder', async () => {
    const f = await fixture();
    await ctx.pool.query('UPDATE products SET stock = 100');
    for (let i = 0; i < 26; i += 1) await ctx.placePaid(f.cookie, [line(f.charm)], f.address);
    const one = await listOrders(f.admin, '?page=1');
    const two = await listOrders(f.admin, '?page=2');
    assert.equal(one.body.orders.length, 25);
    assert.equal(two.body.orders.length, 1);
    assert.equal(two.body.total, 26);
  });

  test('?status= filters; ?q= matches order number or customer email', async () => {
    const f = await fixture();
    const other = await ctx.userWithAddress('eve@example.com');
    const a = await withId(f.admin, await place(f, 1));
    const b = await ctx.placePaid(other.cookie, [line(f.charm)], other.address);
    await setStatus(f.admin, a, 'shipped');

    const shipped = await listOrders(f.admin, '?status=shipped');
    assert.deepEqual(shipped.body.orders.map((o) => o.orderNumber), [a.orderNumber]);
    const placed = await listOrders(f.admin, '?status=placed');
    assert.deepEqual(placed.body.orders.map((o) => o.orderNumber), [b.orderNumber]);
    assert.equal((await listOrders(f.admin, '?status=bogus')).status, 400);

    const byEmail = await listOrders(f.admin, '?q=eve@');
    assert.deepEqual(byEmail.body.orders.map((o) => o.orderNumber), [b.orderNumber]);
    const byNumber = await listOrders(f.admin, `?q=${a.orderNumber}`);
    assert.deepEqual(byNumber.body.orders.map((o) => o.orderNumber), [a.orderNumber]);
    assert.equal((await listOrders(f.admin, '?q=nobody-matches')).body.orders.length, 0);
  });

  test('?status=pending_payment lists only unpaid orders', async () => {
    const f = await fixture();
    const other = await ctx.userWithAddress('eve@example.com');
    const paid = await ctx.placePaid(other.cookie, [line(f.charm)], other.address);
    const pending = (await ctx.placeOrder(f.cookie, [line(f.charm)], f.address)).body.order;

    const unpaid = await listOrders(f.admin, '?status=pending_payment');
    assert.equal(unpaid.status, 200);
    assert.deepEqual(unpaid.body.orders.map((o) => o.orderNumber), [pending.orderNumber]);
    assert.equal(unpaid.body.orders[0].status, 'pending_payment');
    const placed = await listOrders(f.admin, '?status=placed');
    assert.deepEqual(placed.body.orders.map((o) => o.orderNumber), [paid.orderNumber]);
  });

  test('detail is the customer order plus the numeric id and userId; unknown or non-numeric id is 404', async () => {
    const f = await fixture();
    const order = await withId(f.admin, await place(f));
    const res = await ctx.call('GET', `/api/admin/orders/${order.id}`, { cookie: f.admin });
    assert.equal(res.status, 200);
    const { userId, ...rest } = res.body.order;
    assert.equal(typeof userId, 'number');
    assert.deepEqual(rest, order);
    assert.equal((await ctx.call('GET', '/api/admin/orders/999999', { cookie: f.admin })).status, 404);
    assert.equal((await ctx.call('GET', '/api/admin/orders/abc', { cookie: f.admin })).status, 404);
  });
});

describe('admin order status', () => {
  test('placed -> shipped -> delivered, keeping stock decremented', async () => {
    const f = await fixture();
    const order = await withId(f.admin, await place(f));

    const shipped = await setStatus(f.admin, order, 'shipped');
    assert.equal(shipped.status, 200, JSON.stringify(shipped.body));
    assert.equal(shipped.body.order.status, 'shipped');
    assert.equal(shipped.body.order.orderNumber, order.orderNumber);

    const delivered = await setStatus(f.admin, order, 'delivered');
    assert.equal(delivered.status, 200);
    assert.equal(delivered.body.order.status, 'delivered');
    assert.equal(await ctx.stockOf('products', f.charm), 3);

    const mine = await ctx.call('GET', `/api/orders/${order.orderNumber}`, { cookie: f.cookie });
    assert.equal(mine.body.order.status, 'delivered');
  });

  test('cancel from placed restores product and accessory stock', async () => {
    const f = await fixture();
    const order = await withId(f.admin, await place(f, 3));
    assert.equal(await ctx.stockOf('products', f.charm), 2);
    assert.equal(await ctx.stockOf('accessories', f.hook), 7);

    const res = await setStatus(f.admin, order, 'cancelled');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.order.status, 'cancelled');
    assert.equal(await ctx.stockOf('products', f.charm), 5);
    assert.equal(await ctx.stockOf('accessories', f.hook), 10);
  });

  test('cancel from shipped restores stock', async () => {
    const f = await fixture();
    const order = await withId(f.admin, await place(f, 2));
    await setStatus(f.admin, order, 'shipped');
    assert.equal((await setStatus(f.admin, order, 'cancelled')).status, 200);
    assert.equal(await ctx.stockOf('products', f.charm), 5);
    assert.equal(await ctx.stockOf('accessories', f.hook), 10);
  });

  test('cancel restores stock even when the product was archived since', async () => {
    const f = await fixture();
    const order = await withId(f.admin, await place(f, 2));
    await ctx.call('POST', `/api/admin/products/${f.charm.id}/archive`, { cookie: f.admin });
    assert.equal((await setStatus(f.admin, order, 'cancelled')).status, 200);
    assert.equal(await ctx.stockOf('products', f.charm), 5);
  });

  test('invalid transitions are 409 and change nothing', async () => {
    const f = await fixture();
    const order = await withId(f.admin, await place(f, 2));

    for (const status of ['delivered', 'placed']) {
      assert.equal((await setStatus(f.admin, order, status)).status, 409, `placed -> ${status}`);
    }
    await setStatus(f.admin, order, 'shipped');
    assert.equal((await setStatus(f.admin, order, 'placed')).status, 409, 'shipped -> placed');
    assert.equal((await setStatus(f.admin, order, 'shipped')).status, 409, 'shipped -> shipped');
    await setStatus(f.admin, order, 'delivered');
    assert.equal((await setStatus(f.admin, order, 'cancelled')).status, 409, 'delivered -> cancelled');
    assert.equal((await setStatus(f.admin, order, 'shipped')).status, 409, 'delivered -> shipped');
    assert.equal(await ctx.stockOf('products', f.charm), 3);
  });

  test('a pending_payment order accepts no status change: 409, still pending, stock still reserved', async () => {
    const f = await fixture();
    const placed = (await ctx.placeOrder(f.cookie, [line(f.charm, 2, [f.hook])], f.address)).body.order;
    const order = await withId(f.admin, placed);
    for (const status of ['pending_payment', 'placed', 'shipped', 'delivered', 'cancelled']) {
      assert.equal((await setStatus(f.admin, order, status)).status, 409, `pending_payment -> ${status}`);
    }
    const res = await ctx.call('GET', `/api/admin/orders/${order.id}`, { cookie: f.admin });
    assert.equal(res.body.order.status, 'pending_payment');
    assert.equal(await ctx.stockOf('products', f.charm), 3);
  });

  test('a cancelled order is final and cancelling twice does not restore stock twice', async () => {
    const f = await fixture();
    const order = await withId(f.admin, await place(f, 2));
    await setStatus(f.admin, order, 'cancelled');
    for (const status of ['placed', 'shipped', 'delivered', 'cancelled']) {
      assert.equal((await setStatus(f.admin, order, status)).status, 409, `cancelled -> ${status}`);
    }
    assert.equal(await ctx.stockOf('products', f.charm), 5);
    assert.equal(await ctx.stockOf('accessories', f.hook), 10);
  });

  test('400 for a missing or unknown status; 404 for an unknown order', async () => {
    const f = await fixture();
    const order = await withId(f.admin, await place(f));
    assert.equal((await setStatus(f.admin, order, 'refunded')).status, 400);
    assert.equal((await setStatus(f.admin, order, undefined)).status, 400);
    assert.equal((await setStatus(f.admin, { id: 999999 }, 'shipped')).status, 404);
  });
});
