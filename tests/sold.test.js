import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { idOf, list } from './helpers.js';
import { setupStoreSuite } from './storefrontHelpers.js';

const ctx = setupStoreSuite();

describe('sold products', () => {
  test('admin can create and toggle sold; the admin view reports it', async () => {
    const cookie = await ctx.adminCookie();
    const product = await ctx.makeProduct(cookie, { name: 'Sold One', sold: true });
    assert.equal(product.sold, true);
    const res = await ctx.call('PATCH', `/api/admin/products/${idOf(product)}`, { cookie, body: { sold: false } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.product.sold, false);
    assert.equal((await ctx.makeProduct(cookie, { name: 'Default' })).sold, false);
    const bad = await ctx.call('PATCH', `/api/admin/products/${idOf(product)}`, { cookie, body: { sold: 'yes' } });
    assert.equal(bad.status, 400);
  });

  test('the slug "sold" is reserved: rejected when given, avoided when generated', async () => {
    const cookie = await ctx.adminCookie();
    const res = await ctx.call('POST', '/api/admin/products', { cookie, body: { name: 'X', collection: 'charms', colorway: 'pastel', priceCents: 100, slug: 'sold' } });
    assert.equal(res.status, 400);
    const generated = await ctx.makeProduct(cookie, { name: 'Sold' });
    assert.match(generated.slug, /^sold-[0-9a-f]{8}$/);
  });

  test('GET /api/products/sold lists live sold pieces only, with the gallery shape', async () => {
    const cookie = await ctx.adminCookie();
    await ctx.makeProduct(cookie, { name: 'For Sale' });
    await ctx.makeProduct(cookie, { name: 'Sold Live', sold: true, description: 'A red apple.' });
    await ctx.makeProduct(cookie, { name: 'Sold Hidden', sold: true, active: false });
    const res = await ctx.call('GET', '/api/products/sold');
    assert.equal(res.status, 200);
    const items = list(res.body, 'products');
    assert.deepEqual(items.map((p) => p.name), ['Sold Live']);
    assert.deepEqual(Object.keys(items[0]).sort(), ['collection', 'colorway', 'description', 'mainImageUrl', 'name', 'publicId']);
    assert.equal(items[0].description, 'A red apple.');
  });

  test('sold products are not listed, not viewable and cannot be quoted or ordered', async () => {
    const cookie = await ctx.adminCookie();
    const sold = await ctx.makeProduct(cookie, { name: 'Gone Piece', sold: true, stock: 5 });
    assert.equal(list((await ctx.call('GET', '/api/products')).body, 'products').length, 0);
    assert.equal((await ctx.call('GET', `/api/products/${sold.slug}`)).status, 404);
    const items = [{ slug: sold.slug, accessoryIds: [], quantity: 1 }];
    assert.equal((await ctx.call('POST', '/api/checkout/quote', { body: { items } })).status, 404);
    const { cookie: buyer, address } = await ctx.userWithAddress();
    assert.equal((await ctx.placeOrder(buyer, items, address)).status, 404);
    assert.equal(await ctx.stockOf('products', sold), 5);
  });
});
