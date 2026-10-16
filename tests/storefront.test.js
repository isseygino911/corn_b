import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { idOf, list, setupSuite } from './helpers.js';

const ctx = setupSuite();
const archive = (cookie, kind, e) => ctx.call('POST', `/api/admin/${kind}/${idOf(e)}/archive`, { cookie });
const quote = (slug, accessoryIds) => ctx.call('POST', `/api/products/${slug}/quote`, { body: { accessoryIds } });

async function seedImage(cookie, product) {
  const up = await ctx.call('POST', '/api/admin/uploads', { cookie, body: { contentType: 'image/png', size: 10 } });
  await ctx.call('PUT', `/api/admin/products/${idOf(product)}/images`, {
    cookie,
    body: [{ key: up.body.key, isMain: true }],
  });
  return up.body;
}

describe('public products', () => {
  test('list shows only active, non-archived products with the public shape and no auth', async () => {
    const cookie = await ctx.adminCookie();
    const live = await ctx.makeProduct(cookie, { name: 'Live' });
    await ctx.makeProduct(cookie, { name: 'Hidden', active: false });
    const gone = await ctx.makeProduct(cookie, { name: 'Gone' });
    await archive(cookie, 'products', gone);
    const upload = await seedImage(cookie, live);

    const res = await ctx.call('GET', '/api/products');
    assert.equal(res.status, 200);
    const items = list(res.body, 'products');
    assert.equal(items.length, 1);
    const [p] = items;
    assert.equal(p.name, 'Live');
    assert.equal(p.sku, live.sku);
    assert.equal(p.collection, 'charms');
    assert.equal(p.colorway, 'pastel');
    assert.equal(p.priceCents, 1000);
    assert.equal(p.soldOut, false);
    assert.equal(p.mainImageUrl, upload.publicUrl);
    assert.match(p.publicId, /^[0-9a-f-]{36}$/);
    assert.ok(p.slug);
    for (const leaked of ['id', 'stock', 'active', 'archivedAt', 'archived_at']) {
      assert.equal(leaked in p, false, `${leaked} must not be exposed`);
    }
  });

  test('?collection= filters; stock 0 is soldOut but still listed', async () => {
    const cookie = await ctx.adminCookie();
    await ctx.makeProduct(cookie, { name: 'Charm' });
    await ctx.makeProduct(cookie, { name: 'Pearl', collection: 'pearls', stock: 0 });
    const pearls = list((await ctx.call('GET', '/api/products?collection=pearls')).body, 'products');
    assert.deepEqual(pearls.map((p) => [p.name, p.soldOut]), [['Pearl', true]]);
    assert.equal(list((await ctx.call('GET', '/api/products')).body, 'products').length, 2);
  });

  test('detail by slug: images, description, only allowed ACTIVE accessories', async () => {
    const cookie = await ctx.adminCookie();
    const ok = await ctx.makeAccessory(cookie, { name: 'Ok', priceCents: 200 });
    const off = await ctx.makeAccessory(cookie, { name: 'Off', active: false });
    const arch = await ctx.makeAccessory(cookie, { name: 'Arch' });
    await ctx.makeAccessory(cookie, { name: 'Unlinked' });
    const p = await ctx.makeProduct(cookie, {
      accessoryIds: [ok.publicId, off.publicId, arch.publicId],
    });
    await archive(cookie, 'accessories', arch);
    const upload = await seedImage(cookie, p);

    const res = await ctx.call('GET', `/api/products/${p.slug}`);
    assert.equal(res.status, 200);
    const body = res.body.product;
    assert.equal(body.description, 'A bead charm.');
    assert.deepEqual(body.images, [{ url: upload.publicUrl, isMain: true }]);
    assert.deepEqual(body.accessories.map((a) => a.name), ['Ok']);
    assert.deepEqual(Object.keys(body.accessories[0]).sort(), ['imageUrl', 'name', 'priceCents', 'publicId', 'soldOut']);
  });

  test('inactive and archived products are 404 by slug', async () => {
    const cookie = await ctx.adminCookie();
    const off = await ctx.makeProduct(cookie, { name: 'Off', active: false });
    const gone = await ctx.makeProduct(cookie, { name: 'Gone' });
    await archive(cookie, 'products', gone);
    assert.equal((await ctx.call('GET', `/api/products/${off.slug}`)).status, 404);
    assert.equal((await ctx.call('GET', `/api/products/${gone.slug}`)).status, 404);
    assert.equal((await ctx.call('GET', '/api/products/no-such-slug')).status, 404);
    assert.equal((await quote(off.slug, [])).status, 404);
  });
});

describe('quote', () => {
  async function fixture() {
    const cookie = await ctx.adminCookie();
    const a = await ctx.makeAccessory(cookie, { name: 'A', priceCents: 200 });
    const b = await ctx.makeAccessory(cookie, { name: 'B', priceCents: 200 });
    const c = await ctx.makeAccessory(cookie, { name: 'C', priceCents: 600 });
    const p = await ctx.makeProduct(cookie, { priceCents: 1000, accessoryIds: [a.publicId, b.publicId, c.publicId] });
    return { cookie, a, b, c, p };
  }

  test('no accessories: product price only', async () => {
    const { p } = await fixture();
    const res = await quote(p.slug, []);
    assert.equal(res.status, 200);
    assert.equal(res.body.productCents, 1000);
    assert.deepEqual(res.body.accessories, []);
    assert.equal(res.body.totalCents, 1000);
  });

  test('$10 + 2 + 2 + 6 = $20', async () => {
    const { p, a, b, c } = await fixture();
    const res = await quote(p.slug, [a.publicId, b.publicId, c.publicId]);
    assert.equal(res.status, 200);
    assert.equal(res.body.productCents, 1000);
    assert.equal(res.body.accessories.length, 3);
    assert.equal(res.body.totalCents, 2000);
  });

  test('any subset sums correctly; a client-sent total is ignored', async () => {
    const { p, a, c } = await fixture();
    const res = await ctx.call('POST', `/api/products/${p.slug}/quote`, {
      body: { accessoryIds: [a.publicId, c.publicId], totalCents: 1, priceCents: 1 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.totalCents, 1800);
  });

  test('400 for sold out, inactive, archived, not-allowed, unknown, or malformed accessories', async () => {
    const { cookie, p, a } = await fixture();
    const soldOut = await ctx.makeAccessory(cookie, { name: 'S', stock: 0 });
    const inactive = await ctx.makeAccessory(cookie, { name: 'I' });
    const archived = await ctx.makeAccessory(cookie, { name: 'R' });
    const stranger = await ctx.makeAccessory(cookie, { name: 'N' });
    const linked = await ctx.makeProduct(cookie, {
      name: 'Linked',
      accessoryIds: [soldOut.publicId, inactive.publicId, archived.publicId],
    });
    await ctx.call('PATCH', `/api/admin/accessories/${idOf(inactive)}`, { cookie, body: { active: false } });
    await archive(cookie, 'accessories', archived);

    for (const id of [soldOut.publicId, inactive.publicId, archived.publicId]) {
      assert.equal((await quote(linked.slug, [id])).status, 400, id);
    }
    assert.equal((await quote(p.slug, [stranger.publicId])).status, 400, 'not allowed for this product');
    assert.equal((await quote(p.slug, ['00000000-0000-4000-8000-000000000000'])).status, 400, 'unknown');
    assert.equal((await quote(p.slug, ['nope'])).status, 400, 'malformed');
  });

  test('a sold-out product can still be read, and its accessories flagged soldOut', async () => {
    const cookie = await ctx.adminCookie();
    const acc = await ctx.makeAccessory(cookie, { stock: 0 });
    const p = await ctx.makeProduct(cookie, { stock: 0, accessoryIds: [acc.publicId] });
    const res = await ctx.call('GET', `/api/products/${p.slug}`);
    assert.equal(res.status, 200);
    const body = res.body.product;
    assert.equal(body.soldOut, true);
    assert.equal(body.accessories[0].soldOut, true);
  });
});
