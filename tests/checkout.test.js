import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { line, setupStoreSuite, UNKNOWN_UUID } from './storefrontHelpers.js';

const ctx = setupStoreSuite();

const quote = (items, countryCode) => ctx.call('POST', '/api/checkout/quote', { body: { items, countryCode } });

async function fixture() {
  const cookie = await ctx.adminCookie();
  const hook = await ctx.makeAccessory(cookie, { name: 'Hook', priceCents: 200 });
  const chain = await ctx.makeAccessory(cookie, { name: 'Chain', priceCents: 600 });
  const charm = await ctx.makeProduct(cookie, { name: 'Charm', priceCents: 1000, accessoryIds: [hook.publicId, chain.publicId] });
  return { cookie, hook, chain, charm };
}

describe('checkout quote, shipping off', () => {
  test('subtotal = (product + accessories) x qty; tax at the default 9.25%; shipping 0; total sums', async () => {
    const { charm, hook, chain } = await fixture();
    const res = await quote([line(charm, 2, [hook, chain])]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // (1000 + 200 + 600) x 2 = 3600; 3600 x 925 / 10000 = 333
    assert.equal(res.body.subtotalCents, 3600);
    assert.equal(res.body.shippingCents, 0);
    assert.equal(res.body.taxCents, 333);
    assert.equal(res.body.totalCents, 3933);
  });

  test('lines describe each item with its accessories and line total', async () => {
    const { charm, hook } = await fixture();
    const res = await quote([line(charm, 3, [hook])]);
    assert.equal(res.body.lines.length, 1);
    const [l] = res.body.lines;
    assert.equal(l.slug, charm.slug);
    assert.equal(l.name, 'Charm');
    assert.equal(l.quantity, 3);
    assert.equal(l.unitCents, 1000);
    assert.equal(l.lineCents, 3600);
    assert.deepEqual(l.accessories, [{ publicId: hook.publicId, name: 'Hook', priceCents: 200 }]);
  });

  test('several lines are summed', async () => {
    const { cookie, charm, hook } = await fixture();
    const pearl = await ctx.makeProduct(cookie, { name: 'Pearl', priceCents: 2500 });
    const res = await quote([line(charm, 1, [hook]), line(pearl, 2)]);
    assert.equal(res.body.subtotalCents, 1200 + 5000);
  });

  test('tax rounds to the nearest cent: 92.5 rounds up, 93.425 rounds down', async () => {
    const { cookie, charm } = await fixture();
    assert.equal((await quote([line(charm)])).body.taxCents, 93);
    const odd = await ctx.makeProduct(cookie, { name: 'Odd', priceCents: 1010 });
    assert.equal((await quote([line(odd)])).body.taxCents, 93);
    const high = await ctx.makeProduct(cookie, { name: 'High', priceCents: 1060 });
    assert.equal((await quote([line(high)])).body.taxCents, 98); // 98.05
  });

  test('uses the admin-set tax rate; 0% gives no tax', async () => {
    const { cookie, charm } = await fixture();
    await ctx.setSettings(cookie, { taxRateBps: 800 });
    const res = await quote([line(charm)]);
    assert.equal(res.body.taxCents, 80);
    assert.equal(res.body.totalCents, 1080);
    await ctx.setSettings(cookie, { taxRateBps: 0 });
    const free = await quote([line(charm)]);
    assert.equal(free.body.taxCents, 0);
    assert.equal(free.body.totalCents, 1000);
  });

  test('a countryCode and rates are ignored while shipping is off', async () => {
    const { cookie, charm } = await fixture();
    await ctx.addRate(cookie, { countryCode: 'US', priceCents: 500 });
    const res = await quote([line(charm)], 'US');
    assert.equal(res.body.shippingCents, 0);
  });

  test('client-sent totals and prices are ignored', async () => {
    const { charm } = await fixture();
    const res = await ctx.call('POST', '/api/checkout/quote', {
      body: { items: [{ ...line(charm), priceCents: 1, totalCents: 1 }], totalCents: 1, taxCents: 0, shippingCents: 0 },
    });
    assert.equal(res.body.subtotalCents, 1000);
    assert.equal(res.body.totalCents, 1093);
  });
});

describe('checkout quote, shipping on', () => {
  async function shipping() {
    const f = await fixture();
    await ctx.setSettings(f.cookie, { shippingEnabled: true });
    return f;
  }

  test('country row wins; shipping is added untaxed', async () => {
    const { cookie, charm } = await shipping();
    await ctx.addRate(cookie, { countryCode: 'US', priceCents: 500 });
    await ctx.addRate(cookie, { priceCents: 1500 });
    const res = await quote([line(charm)], 'US');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.shippingCents, 500);
    assert.equal(res.body.taxCents, 93); // shipping not taxed
    assert.equal(res.body.totalCents, 1000 + 500 + 93);
  });

  test('another country falls back to the default row', async () => {
    const { cookie, charm } = await shipping();
    await ctx.addRate(cookie, { countryCode: 'US', priceCents: 500 });
    await ctx.addRate(cookie, { priceCents: 1500 });
    assert.equal((await quote([line(charm)], 'GB')).body.shippingCents, 1500);
  });

  test('no matching or default row is rejected: "We don\'t ship there yet"', async () => {
    const { cookie, charm } = await shipping();
    await ctx.addRate(cookie, { countryCode: 'US', priceCents: 500 });
    const res = await quote([line(charm)], 'GB');
    assert.equal(res.status, 400);
    assert.match(res.body.error ?? res.body.message, /ship there/i);
  });

  test('an inactive country row is not used', async () => {
    const { cookie, charm } = await shipping();
    await ctx.addRate(cookie, { countryCode: 'US', priceCents: 500, active: false });
    assert.equal((await quote([line(charm)], 'US')).status, 400);
    await ctx.addRate(cookie, { priceCents: 1500 });
    assert.equal((await quote([line(charm)], 'US')).body.shippingCents, 1500);
  });

  test('a missing countryCode cannot be priced', async () => {
    const { cookie, charm } = await shipping();
    await ctx.addRate(cookie, { priceCents: 1500 });
    assert.equal((await quote([line(charm)])).status, 400);
  });
});

describe('checkout quote validation', () => {
  test('400 for empty or malformed items and bad quantities', async () => {
    const { charm } = await fixture();
    for (const items of [[], undefined, 'x', [{}], [{ slug: charm.slug, accessoryIds: [], quantity: 0 }], [{ slug: charm.slug, accessoryIds: [], quantity: 1.5 }], [{ slug: charm.slug, accessoryIds: [], quantity: -1 }]]) {
      assert.equal((await quote(items)).status, 400, JSON.stringify(items));
    }
  });

  test('404 for an unknown, inactive or archived product', async () => {
    const { cookie, charm } = await fixture();
    const off = await ctx.makeProduct(cookie, { name: 'Off', active: false });
    const gone = await ctx.makeProduct(cookie, { name: 'Gone' });
    await ctx.call('POST', `/api/admin/products/${gone.id}/archive`, { cookie });
    assert.equal((await quote([line(off)])).status, 404);
    assert.equal((await quote([line(gone)])).status, 404);
    assert.equal((await quote([{ slug: 'no-such-slug', accessoryIds: [], quantity: 1 }])).status, 404);
    assert.equal((await quote([line(charm)])).status, 200);
  });

  test('400 for sold-out, inactive, archived, not-allowed, unknown or malformed accessories', async () => {
    const { cookie, charm } = await fixture();
    const soldOut = await ctx.makeAccessory(cookie, { name: 'S', stock: 0 });
    const inactive = await ctx.makeAccessory(cookie, { name: 'I' });
    const archived = await ctx.makeAccessory(cookie, { name: 'R' });
    const stranger = await ctx.makeAccessory(cookie, { name: 'N' });
    const linked = await ctx.makeProduct(cookie, {
      name: 'Linked',
      accessoryIds: [soldOut.publicId, inactive.publicId, archived.publicId],
    });
    await ctx.call('PATCH', `/api/admin/accessories/${inactive.id}`, { cookie, body: { active: false } });
    await ctx.call('POST', `/api/admin/accessories/${archived.id}/archive`, { cookie });

    for (const a of [soldOut, inactive, archived]) {
      assert.equal((await quote([line(linked, 1, [a])])).status, 400, a.name);
    }
    assert.equal((await quote([line(charm, 1, [stranger])])).status, 400, 'not allowed for this product');
    assert.equal((await quote([{ slug: charm.slug, accessoryIds: [UNKNOWN_UUID], quantity: 1 }])).status, 400, 'unknown');
    assert.equal((await quote([{ slug: charm.slug, accessoryIds: ['nope'], quantity: 1 }])).status, 400, 'malformed');
  });
});
