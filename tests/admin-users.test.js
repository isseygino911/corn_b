import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { idOf, list, setupSuite } from './helpers.js';

const ctx = setupSuite();

describe('admin users', () => {
  test('read-only list with the contract fields and sign-in method', async () => {
    const cookie = await ctx.adminCookie();
    await ctx.createUser('pw@example.com', { name: 'Pw User' });
    await ctx.createUser('unv@example.com', { verified: false });
    await ctx.createGoogleOnlyUser('goog@example.com');
    await ctx.createUser('both@example.com');
    await ctx.pool.query("UPDATE users SET google_id = 'g-both' WHERE email = 'both@example.com'");

    const res = await ctx.call('GET', '/api/admin/users', { cookie });
    assert.equal(res.status, 200);
    const users = list(res.body, 'users');
    const by = Object.fromEntries(users.map((u) => [u.email, u]));
    assert.equal(users.length, 5);
    assert.equal(by['pw@example.com'].signInMethod, 'password');
    assert.equal(by['goog@example.com'].signInMethod, 'google');
    assert.equal(by['both@example.com'].signInMethod, 'both');
    assert.equal(by['pw@example.com'].verified, true);
    assert.equal(by['unv@example.com'].verified, false);
    assert.equal(by['admin@example.com'].admin, true);
    assert.equal(by['pw@example.com'].admin, false);
    assert.equal(by['pw@example.com'].name, 'Pw User');
    assert.ok(by['pw@example.com'].createdAt);
    for (const u of users) {
      for (const secret of ['password', 'passwordHash', 'password_hash', 'googleId', 'google_id']) {
        assert.equal(secret in u, false, `${secret} leaked`);
      }
    }
  });

  test('?q= searches name and email, case-insensitively', async () => {
    const cookie = await ctx.adminCookie();
    await ctx.createUser('ada@example.com', { name: 'Ada Lovelace' });
    await ctx.createUser('bob@other.org', { name: 'Bob Builder' });
    const q = async (term) =>
      list((await ctx.call('GET', `/api/admin/users?q=${encodeURIComponent(term)}`, { cookie })).body, 'users').map((u) => u.email);
    assert.deepEqual(await q('lovelace'), ['ada@example.com']);
    assert.deepEqual(await q('OTHER.org'), ['bob@other.org']);
    assert.deepEqual(await q('nobody-matches'), []);
  });

  test('?page= paginates without overlap', async () => {
    const cookie = await ctx.adminCookie();
    const values = Array.from({ length: 55 }, (_, i) => [`u${i}@example.com`, `User ${i}`]);
    await ctx.pool.query('INSERT INTO users (email, name) VALUES ?', [values]);
    const page = async (n) => list((await ctx.call('GET', `/api/admin/users?page=${n}`, { cookie })).body, 'users');
    const p1 = await page(1);
    const p2 = await page(2);
    const p3 = await page(3);
    assert.deepEqual([p1.length, p2.length, p3.length], [25, 25, 6]);
    const first = await ctx.call('GET', '/api/admin/users?page=1', { cookie });
    assert.equal(first.body.pageSize, 25);
    assert.equal(first.body.total, 56);
    assert.equal(first.body.page, 1);
    assert.equal(new Set([...p1, ...p2, ...p3].map((u) => u.email)).size, 56);
  });

  test('page must be an integer from 1 to 10000', async () => {
    const cookie = await ctx.adminCookie();
    for (const page of ['0', '-1', '10001', 'abc', '1.5']) {
      assert.equal((await ctx.call('GET', `/api/admin/users?page=${page}`, { cookie })).status, 400, page);
    }
    assert.equal((await ctx.call('GET', '/api/admin/users?page=10000', { cookie })).status, 200);
  });

  test('there is no write route for users', async () => {
    const cookie = await ctx.adminCookie();
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
      const res = await ctx.call(method, '/api/admin/users/1', { cookie, body: { isAdmin: true } });
      assert.ok([404, 405].includes(res.status), `${method} ${res.status}`);
    }
  });
});

describe('admin dashboard', () => {
  test('counts users, products (active/inactive), accessories, sold-out', async () => {
    const cookie = await ctx.adminCookie();
    await ctx.createUser('ada@example.com');
    await ctx.makeProduct(cookie, { name: 'A' });
    await ctx.makeProduct(cookie, { name: 'B', stock: 0 });
    await ctx.makeProduct(cookie, { name: 'C', active: false });
    const gone = await ctx.makeProduct(cookie, { name: 'D' });
    await ctx.call('POST', `/api/admin/products/${idOf(gone)}/archive`, { cookie });
    await ctx.makeAccessory(cookie, { name: 'X' });
    await ctx.makeAccessory(cookie, { name: 'Y', stock: 0 });

    const res = await ctx.call('GET', '/api/admin/dashboard', { cookie });
    assert.equal(res.status, 200);
    const d = res.body;
    assert.equal(d.users, 2);
    assert.equal(d.accessories, 2);
    const products = d.products;
    assert.equal(products.active, 2, 'archived rows are not counted');
    assert.equal(products.inactive, 1);
    assert.equal(d.soldOut, 2, 'one product and one accessory with stock 0');
  });
});
