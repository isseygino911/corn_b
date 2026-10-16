import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setupSuite } from './helpers.js';

const ctx = setupSuite();

describe('product detail maxQuantity', () => {
  for (const [stock, expected] of [[3, 3], [10, 10], [25, 10], [0, 0]]) {
    test(`stock ${stock} gives maxQuantity ${expected}`, async () => {
      const cookie = await ctx.adminCookie();
      const product = await ctx.makeProduct(cookie, { stock });
      const res = await ctx.call('GET', `/api/products/${product.slug}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.product.maxQuantity, expected);
    });
  }
});
