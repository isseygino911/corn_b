import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setupSuite } from './helpers.js';

const ctx = setupSuite();

// Every admin route in the contract. `:id` is a placeholder; auth must reject before the row is looked up.
const ROUTES = [
  ['GET', '/api/admin/dashboard'],
  ['GET', '/api/admin/users'],
  ['GET', '/api/admin/products'],
  ['POST', '/api/admin/products'],
  ['GET', '/api/admin/products/1'],
  ['PATCH', '/api/admin/products/1'],
  ['POST', '/api/admin/products/1/archive'],
  ['POST', '/api/admin/products/1/restore'],
  ['PUT', '/api/admin/products/1/images'],
  ['POST', '/api/admin/uploads'],
  ['GET', '/api/admin/accessories'],
  ['POST', '/api/admin/accessories'],
  ['PATCH', '/api/admin/accessories/1'],
  ['POST', '/api/admin/accessories/1/archive'],
  ['POST', '/api/admin/accessories/1/restore'],
];

describe('requireAdmin on every admin route', () => {
  for (const [method, path] of ROUTES) {
    test(`${method} ${path}: 401 signed out, 403 for a normal user`, async () => {
      const body = method === 'GET' ? undefined : {};
      assert.equal((await ctx.call(method, path, { body })).status, 401);
      const cookie = await ctx.cookieFor('user@example.com');
      assert.equal((await ctx.call(method, path, { body, cookie })).status, 403);
    });
  }
});
