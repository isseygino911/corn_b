import assert from 'node:assert/strict';
import { beforeEach } from 'node:test';
import { idOf, setupSuite } from './helpers.js';

export const ADDRESS = {
  fullName: 'Ada Lovelace',
  phone: '555-0100',
  line1: '1 Main St',
  countryCode: 'US',
  stateCode: 'CA',
  city: 'Los Angeles',
  postalCode: '90001',
};
export const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

const RESET_TABLES = ['order_item_accessories', 'order_items', 'orders', 'shipping_rates', 'settings'];

// setupSuite plus storefront tables reset per test and helpers for settings, shipping, addresses and orders.
// Absent `settings` rows must read as the defaults (tax 925 bps, shipping off).
export function setupStoreSuite() {
  const ctx = setupSuite();

  beforeEach(async () => {
    const conn = await ctx.pool.getConnection();
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of RESET_TABLES) await conn.query(`TRUNCATE TABLE ${table}`);
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      conn.release();
    }
  });

  ctx.setSettings = async (cookie, body) => {
    const res = await ctx.call('PATCH', '/api/admin/settings', { cookie, body });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.settings;
  };

  ctx.addRate = async (cookie, body) => {
    const res = await ctx.call('POST', '/api/admin/shipping-rates', { cookie, body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.shippingRate;
  };

  // Verified user with one saved address (the default). Returns { cookie, address }.
  ctx.userWithAddress = async (email = 'ada@example.com', address = {}) => {
    const cookie = await ctx.cookieFor(email);
    const res = await ctx.call('POST', '/api/account/addresses', { cookie, body: { ...ADDRESS, ...address } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { cookie, address: res.body.address };
  };

  ctx.placeOrder = (cookie, items, address, extra = {}) =>
    ctx.call('POST', '/api/orders', { cookie, body: { items, addressId: idOf(address), ...extra } });

  ctx.stockOf = async (table, entity) => (await ctx.row(`SELECT stock FROM ${table} WHERE id = ?`, [idOf(entity)])).stock;

  return ctx;
}

export const line = (product, quantity = 1, accessories = []) => ({
  slug: product.slug,
  accessoryIds: accessories.map((a) => a.publicId),
  quantity,
});
