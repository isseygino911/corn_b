import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ACCESSORY, idOf, list, setupSuite } from './helpers.js';

const ctx = setupSuite();
const SKU = /^[A-Z]{3}\d{4}$/;
const png = { contentType: 'image/png', size: 1024 };

describe('admin products', () => {
  test('create generates a CHM / PRL sku, next number per prefix', async () => {
    const cookie = await ctx.adminCookie();
    const a = await ctx.makeProduct(cookie);
    const b = await ctx.makeProduct(cookie, { name: 'Second' });
    const p = await ctx.makeProduct(cookie, { name: 'Pearl', collection: 'pearls' });
    assert.match(a.sku, SKU);
    assert.equal(a.sku.slice(0, 3), 'CHM');
    assert.equal(Number(b.sku.slice(3)), Number(a.sku.slice(3)) + 1);
    assert.equal(p.sku, 'PRL0001');
    assert.equal(a.sku, 'CHM0001');
  });

  test('sku is editable and a clash is 409', async () => {
    const cookie = await ctx.adminCookie();
    const a = await ctx.makeProduct(cookie, { sku: 'CHM0100' });
    assert.equal(a.sku, 'CHM0100');
    const dup = await ctx.call('POST', '/api/admin/products', {
      cookie,
      body: { name: 'Other', collection: 'charms', colorway: 'pastel', priceCents: 500, sku: 'CHM0100' },
    });
    assert.equal(dup.status, 409);
    const b = await ctx.makeProduct(cookie, { name: 'Other' });
    const patch = await ctx.call('PATCH', `/api/admin/products/${idOf(b)}`, { cookie, body: { sku: 'CHM0100' } });
    assert.equal(patch.status, 409);
  });

  test('sku: next number follows the highest existing one, past four digits', async () => {
    const cookie = await ctx.adminCookie();
    await ctx.makeProduct(cookie, { name: 'Big', sku: 'CHM9999' });
    const next = await ctx.makeProduct(cookie, { name: 'Next' });
    assert.equal(next.sku, 'CHM10000');
  });

  test('explicit sku is three letters plus 4–8 digits', async () => {
    const cookie = await ctx.adminCookie();
    const post = (sku, name) =>
      ctx.call('POST', '/api/admin/products', {
        cookie,
        body: { name, collection: 'charms', colorway: 'pastel', priceCents: 100, sku },
      });
    assert.equal((await post('AAA1234', 'Four')).status, 201);
    assert.equal((await post('AAA12345678', 'Eight')).status, 201);
    for (const [i, sku] of ['AAA123', 'AAA123456789', 'AA1234', 'AAA12_34'].entries()) {
      assert.equal((await post(sku, `Bad ${i}`)).status, 400, sku);
    }
  });

  test('same name twice: auto slug gets a suffix; a typed slug clash is 409', async () => {
    const cookie = await ctx.adminCookie();
    const a = await ctx.makeProduct(cookie);
    const b = await ctx.makeProduct(cookie);
    assert.notEqual(a.slug, b.slug);
    assert.match(b.slug, new RegExp(`^${a.slug}-[a-z0-9]{4}$`));
    const typed = await ctx.call('POST', '/api/admin/products', {
      cookie,
      body: { name: 'Typed', collection: 'charms', colorway: 'pastel', priceCents: 100, slug: a.slug },
    });
    assert.equal(typed.status, 409);
  });

  test('validation: bad collection, colorway, negative price, missing name', async () => {
    const cookie = await ctx.adminCookie();
    for (const bad of [
      { collection: 'rings' },
      { colorway: 'Not A Slug!' },
      { colorway: '' },
      { priceCents: -1 },
      { priceCents: 10.5 },
      { name: '' },
    ]) {
      const res = await ctx.call('POST', '/api/admin/products', {
        cookie,
        body: { name: 'X', collection: 'charms', colorway: 'pastel', priceCents: 100, ...bad },
      });
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
  });

  test('colorway is a free slug: new slugs accepted, uppercase/spaces/symbols rejected', async () => {
    const cookie = await ctx.adminCookie();
    const ember = await ctx.makeProduct(cookie, { name: 'Ember', colorway: 'ember' });
    assert.equal(ember.colorway, 'ember');
    for (const colorway of ['Ember', 'two words', 'under_score', 'x'.repeat(41)]) {
      const res = await ctx.call('POST', '/api/admin/products', {
        cookie,
        body: { name: 'Bad', collection: 'charms', priceCents: 100, colorway },
      });
      assert.equal(res.status, 400, colorway);
    }
    const patch = await ctx.call('PATCH', `/api/admin/products/${idOf(ember)}`, { cookie, body: { colorway: 'Bad Slug' } });
    assert.equal(patch.status, 400);
  });

  test('read, update, and list include inactive products', async () => {
    const cookie = await ctx.adminCookie();
    const p = await ctx.makeProduct(cookie, { active: false });
    const got = await ctx.call('GET', `/api/admin/products/${idOf(p)}`, { cookie });
    assert.equal(got.status, 200);
    const patch = await ctx.call('PATCH', `/api/admin/products/${idOf(p)}`, {
      cookie,
      body: { name: 'Renamed', priceCents: 1500, stock: 0 },
    });
    assert.equal(patch.status, 200);
    const all = list((await ctx.call('GET', '/api/admin/products', { cookie })).body, 'products');
    assert.equal(all.length, 1);
    assert.equal(all[0].name, 'Renamed');
    assert.equal(all[0].priceCents, 1500);
    assert.equal(all[0].active, false);
  });

  test('archiving a linked accessory drops it from the product\'s accessoryIds', async () => {
    const cookie = await ctx.adminCookie();
    const keep = await ctx.makeAccessory(cookie, { name: 'Keep' });
    const drop = await ctx.makeAccessory(cookie, { name: 'Drop' });
    const p = await ctx.makeProduct(cookie, { accessoryIds: [keep.publicId, drop.publicId] });
    await ctx.call('POST', `/api/admin/accessories/${idOf(drop)}/archive`, { cookie });
    const res = await ctx.call('PATCH', `/api/admin/products/${idOf(p)}`, { cookie, body: { name: 'Renamed' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.product.accessoryIds, [keep.publicId]);
    const got = await ctx.call('GET', `/api/admin/products/${idOf(p)}`, { cookie });
    assert.deepEqual(got.body.product.accessoryIds, [keep.publicId]);
  });

  test('archive hides from the default list, ?archived= shows it, restore brings it back', async () => {
    const cookie = await ctx.adminCookie();
    const p = await ctx.makeProduct(cookie);
    assert.equal((await ctx.call('POST', `/api/admin/products/${idOf(p)}/archive`, { cookie })).status, 200);
    assert.equal(list((await ctx.call('GET', '/api/admin/products', { cookie })).body, 'products').length, 0);
    const archived = await ctx.call('GET', '/api/admin/products?archived=1', { cookie });
    assert.equal(list(archived.body, 'products').length, 1);
    assert.equal((await ctx.row('SELECT COUNT(*) n FROM products')).n, 1, 'never hard deleted');
    assert.equal((await ctx.call('POST', `/api/admin/products/${idOf(p)}/restore`, { cookie })).status, 200);
    assert.equal(list((await ctx.call('GET', '/api/admin/products', { cookie })).body, 'products').length, 1);
  });

  test('unknown product is 404', async () => {
    const cookie = await ctx.adminCookie();
    assert.equal((await ctx.call('GET', '/api/admin/products/999999', { cookie })).status, 404);
  });

  test('accessoryIds replaces the links', async () => {
    const cookie = await ctx.adminCookie();
    const a1 = await ctx.makeAccessory(cookie, { name: 'A1' });
    const a2 = await ctx.makeAccessory(cookie, { name: 'A2' });
    const p = await ctx.makeProduct(cookie, { accessoryIds: [a1.publicId, a2.publicId] });
    const count = async () => (await ctx.row('SELECT COUNT(*) n FROM product_accessories')).n;
    assert.equal(await count(), 2);
    await ctx.call('PATCH', `/api/admin/products/${idOf(p)}`, { cookie, body: { accessoryIds: [a2.publicId] } });
    assert.equal(await count(), 1);
    await ctx.call('PATCH', `/api/admin/products/${idOf(p)}`, { cookie, body: { accessoryIds: [] } });
    assert.equal(await count(), 0);
  });
});

describe('admin accessories', () => {
  test('create generates an ACC sku, edit, archive and restore', async () => {
    const cookie = await ctx.adminCookie();
    const a = await ctx.makeAccessory(cookie);
    const b = await ctx.makeAccessory(cookie, { name: 'Second' });
    assert.equal(a.sku, 'ACC0001');
    assert.equal(b.sku, 'ACC0002');
    const dup = await ctx.call('POST', '/api/admin/accessories', { cookie, body: { ...ACCESSORY, sku: 'ACC0001' } });
    assert.equal(dup.status, 409);
    const patch = await ctx.call('PATCH', `/api/admin/accessories/${idOf(a)}`, {
      cookie,
      body: { priceCents: 350, imageKey: 'accessories/3f2b8c1e-5d4a-4e7b-9c1a-2b6d8e0f1a3c.png' },
    });
    assert.equal(patch.status, 200);
    await ctx.call('POST', `/api/admin/accessories/${idOf(a)}/archive`, { cookie });
    const visible = list((await ctx.call('GET', '/api/admin/accessories', { cookie })).body, 'accessories');
    assert.deepEqual(visible.map((x) => x.sku), ['ACC0002']);
    await ctx.call('POST', `/api/admin/accessories/${idOf(a)}/restore`, { cookie });
    assert.equal(list((await ctx.call('GET', '/api/admin/accessories', { cookie })).body, 'accessories').length, 2);
  });

  test('validation: negative price and empty name are 400', async () => {
    const cookie = await ctx.adminCookie();
    for (const bad of [{ priceCents: -5 }, { name: '' }]) {
      const res = await ctx.call('POST', '/api/admin/accessories', { cookie, body: { ...ACCESSORY, ...bad } });
      assert.equal(res.status, 400);
    }
  });
});

describe('uploads and images', () => {
  test('presign returns uploadUrl, a products/<uuid>.<ext> key and publicUrl', async () => {
    const cookie = await ctx.adminCookie();
    for (const [contentType, ext] of [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]) {
      const res = await ctx.call('POST', '/api/admin/uploads', { cookie, body: { contentType, size: 2048 } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.match(res.body.key, new RegExp(`^products/[0-9a-f-]{36}\\.(${ext}|jpeg)$`));
      assert.equal(typeof res.body.uploadUrl, 'string');
      assert.ok(res.body.publicUrl.endsWith(res.body.key));
    }
  });

  test('kind: product (default) uses products/, accessory uses accessories/, anything else is 400', async () => {
    const cookie = await ctx.adminCookie();
    const up = (extra) =>
      ctx.call('POST', '/api/admin/uploads', { cookie, body: { contentType: 'image/png', size: 100, ...extra } });
    assert.match((await up({})).body.key, /^products\//);
    assert.match((await up({ kind: 'product' })).body.key, /^products\//);
    const acc = await up({ kind: 'accessory' });
    assert.equal(acc.status, 200);
    assert.match(acc.body.key, /^accessories\/[0-9a-f-]{36}\.png$/);
    for (const kind of ['banner', '', 5]) assert.equal((await up({ kind })).status, 400, String(kind));
  });

  test('rejects other types, oversize (>5 MB), and bad sizes', async () => {
    const cookie = await ctx.adminCookie();
    for (const body of [
      { contentType: 'image/gif', size: 100 },
      { contentType: 'application/pdf', size: 100 },
      { contentType: 'image/png', size: 5 * 1024 * 1024 + 1 },
      { contentType: 'image/png', size: 0 },
      { contentType: 'image/png' },
    ]) {
      const res = await ctx.call('POST', '/api/admin/uploads', { cookie, body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const ok = await ctx.call('POST', '/api/admin/uploads', {
      cookie,
      body: { contentType: 'image/png', size: 5 * 1024 * 1024 },
    });
    assert.equal(ok.status, 200);
  });

  async function keys(cookie, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push((await ctx.call('POST', '/api/admin/uploads', { cookie, body: png })).body.key);
    return out;
  }
  const put = (cookie, p, images) =>
    ctx.call('PUT', `/api/admin/products/${idOf(p)}/images`, { cookie, body: images });

  test('1–5 images, exactly one main, stored in order', async () => {
    const cookie = await ctx.adminCookie();
    const p = await ctx.makeProduct(cookie);
    const k = await keys(cookie, 6);
    const ok = await put(cookie, p, [
      { key: k[0], isMain: false },
      { key: k[1], isMain: true },
      { key: k[2], isMain: false },
    ]);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const [rows] = await ctx.pool.query('SELECT s3_key, is_main FROM product_images ORDER BY position');
    assert.deepEqual(rows.map((r) => r.s3_key), [k[0], k[1], k[2]]);
    assert.deepEqual(rows.map((r) => r.is_main), [0, 1, 0]);

    assert.equal((await put(cookie, p, [])).status, 400, 'empty');
    assert.equal((await put(cookie, p, k.map((key, i) => ({ key, isMain: i === 0 })))).status, 400, 'six');
    assert.equal((await put(cookie, p, [{ key: k[0], isMain: false }])).status, 400, 'no main');
    assert.equal(
      (await put(cookie, p, [{ key: k[0], isMain: true }, { key: k[1], isMain: true }])).status,
      400,
      'two mains',
    );
    assert.equal((await ctx.row('SELECT COUNT(*) n FROM product_images')).n, 3, 'failed puts change nothing');
  });

  test('PUT images on an unknown product is 404', async () => {
    const cookie = await ctx.adminCookie();
    const [k] = await keys(cookie, 1);
    const res = await ctx.call('PUT', '/api/admin/products/999999/images', { cookie, body: [{ key: k, isMain: true }] });
    assert.equal(res.status, 404);
    assert.equal((await ctx.row('SELECT COUNT(*) n FROM product_images')).n, 0);
  });

  test('exactly five images is allowed and replaces the previous set', async () => {
    const cookie = await ctx.adminCookie();
    const p = await ctx.makeProduct(cookie);
    const k = await keys(cookie, 5);
    await put(cookie, p, [{ key: k[0], isMain: true }]);
    const res = await put(cookie, p, k.map((key, i) => ({ key, isMain: i === 0 })));
    assert.equal(res.status, 200);
    assert.equal((await ctx.row('SELECT COUNT(*) n FROM product_images')).n, 5);
  });
});
