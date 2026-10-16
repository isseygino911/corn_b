import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setupStoreSuite } from './storefrontHelpers.js';

const ctx = setupStoreSuite();

const ADMIN_ROUTES = [
  ['GET', '/api/admin/settings'],
  ['PATCH', '/api/admin/settings'],
  ['GET', '/api/admin/shipping-rates'],
  ['POST', '/api/admin/shipping-rates'],
  ['PATCH', '/api/admin/shipping-rates/1'],
  ['DELETE', '/api/admin/shipping-rates/1'],
];
const rates = async (cookie) => (await ctx.call('GET', '/api/admin/shipping-rates', { cookie })).body.shippingRates;
const createRate = (cookie, body) => ctx.call('POST', '/api/admin/shipping-rates', { cookie, body });

describe('settings and shipping admin auth', () => {
  for (const [method, path] of ADMIN_ROUTES) {
    test(`${method} ${path} is 401 signed out and 403 for a non-admin`, async () => {
      const body = method === 'GET' || method === 'DELETE' ? undefined : {};
      assert.equal((await ctx.call(method, path, { body })).status, 401);
      const cookie = await ctx.cookieFor('user@example.com');
      assert.equal((await ctx.call(method, path, { cookie, body })).status, 403);
    });
  }
});

describe('settings', () => {
  test('public storefront settings default to 9.25% tax and shipping off, with no auth', async () => {
    const res = await ctx.call('GET', '/api/settings/storefront');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { taxRateBps: 925, shippingEnabled: false });
  });

  test('admin reads defaults, patches either field, and the public endpoint follows', async () => {
    const cookie = await ctx.adminCookie();
    const read = await ctx.call('GET', '/api/admin/settings', { cookie });
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.settings, { taxRateBps: 925, shippingEnabled: false });

    assert.deepEqual(await ctx.setSettings(cookie, { taxRateBps: 750 }), { taxRateBps: 750, shippingEnabled: false });
    assert.deepEqual(await ctx.setSettings(cookie, { shippingEnabled: true }), { taxRateBps: 750, shippingEnabled: true });
    assert.deepEqual((await ctx.call('GET', '/api/settings/storefront')).body, { taxRateBps: 750, shippingEnabled: true });
  });

  test('tax rate accepts the 0 and 5000 bounds', async () => {
    const cookie = await ctx.adminCookie();
    assert.equal((await ctx.setSettings(cookie, { taxRateBps: 0 })).taxRateBps, 0);
    assert.equal((await ctx.setSettings(cookie, { taxRateBps: 5000 })).taxRateBps, 5000);
  });

  test('400 for out-of-range, fractional, non-numeric or non-boolean values, changing nothing', async () => {
    const cookie = await ctx.adminCookie();
    const bad = [{ taxRateBps: -1 }, { taxRateBps: 5001 }, { taxRateBps: 9.5 }, { taxRateBps: '900' }, { taxRateBps: null }, { shippingEnabled: 'yes' }];
    for (const body of bad) {
      assert.equal((await ctx.call('PATCH', '/api/admin/settings', { cookie, body })).status, 400, JSON.stringify(body));
    }
    assert.deepEqual((await ctx.call('GET', '/api/settings/storefront')).body, { taxRateBps: 925, shippingEnabled: false });
  });
});

describe('shipping rates', () => {
  test('create a country row and the default row; list shows both', async () => {
    const cookie = await ctx.adminCookie();
    const us = await createRate(cookie, { countryCode: 'US', priceCents: 500 });
    assert.equal(us.status, 201, JSON.stringify(us.body));
    assert.deepEqual(
      { countryCode: us.body.shippingRate.countryCode, priceCents: us.body.shippingRate.priceCents, active: us.body.shippingRate.active },
      { countryCode: 'US', priceCents: 500, active: true },
    );
    assert.equal(typeof us.body.shippingRate.id, 'number');
    const fallback = await createRate(cookie, { priceCents: 1500, active: false });
    assert.equal(fallback.status, 201, JSON.stringify(fallback.body));
    assert.equal(fallback.body.shippingRate.countryCode, null);
    assert.equal(fallback.body.shippingRate.active, false);

    const codes = (await rates(cookie)).map((r) => r.countryCode).sort((a, b) => (a ?? '').localeCompare(b ?? ''));
    assert.deepEqual(codes, [null, 'US']);
  });

  test('country code is normalised to upper case', async () => {
    const cookie = await ctx.adminCookie();
    const res = await createRate(cookie, { countryCode: 'gb', priceCents: 900 });
    assert.equal(res.status, 201);
    assert.equal(res.body.shippingRate.countryCode, 'GB');
  });

  test('400 for an unknown or malformed country code, a bad price, or a missing price', async () => {
    const cookie = await ctx.adminCookie();
    const bad = [
      { countryCode: 'ZZ', priceCents: 500 },
      { countryCode: 'USA', priceCents: 500 },
      { countryCode: 'U', priceCents: 500 },
      { countryCode: 12, priceCents: 500 },
      { countryCode: 'US', priceCents: -1 },
      { countryCode: 'US', priceCents: 5.5 },
      { countryCode: 'US', priceCents: '500' },
      { countryCode: 'US' },
    ];
    for (const body of bad) assert.equal((await createRate(cookie, body)).status, 400, JSON.stringify(body));
    assert.deepEqual(await rates(cookie), []);
  });

  test('409 for a second row with the same country, and for a second default row', async () => {
    const cookie = await ctx.adminCookie();
    await ctx.addRate(cookie, { countryCode: 'US', priceCents: 500 });
    await ctx.addRate(cookie, { priceCents: 1500 });
    assert.equal((await createRate(cookie, { countryCode: 'US', priceCents: 700 })).status, 409);
    assert.equal((await createRate(cookie, { priceCents: 700 })).status, 409);
    assert.equal((await rates(cookie)).length, 2);
  });

  test('patch changes price and active; moving to a taken country is 409; bad values are 400', async () => {
    const cookie = await ctx.adminCookie();
    const us = await ctx.addRate(cookie, { countryCode: 'US', priceCents: 500 });
    const gb = await ctx.addRate(cookie, { countryCode: 'GB', priceCents: 900 });

    const patch = (rate, body) => ctx.call('PATCH', `/api/admin/shipping-rates/${rate.id}`, { cookie, body });
    const ok = await patch(us, { priceCents: 650, active: false });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.shippingRate.priceCents, 650);
    assert.equal(ok.body.shippingRate.active, false);
    assert.equal(ok.body.shippingRate.countryCode, 'US');

    assert.equal((await patch(gb, { countryCode: 'US' })).status, 409);
    assert.equal((await patch(gb, { countryCode: 'ZZ' })).status, 400);
    assert.equal((await patch(gb, { priceCents: -5 })).status, 400);
    assert.equal((await ctx.call('PATCH', '/api/admin/shipping-rates/999999', { cookie, body: { priceCents: 1 } })).status, 404);
  });

  test('delete is a hard delete; unknown id is 404', async () => {
    const cookie = await ctx.adminCookie();
    const us = await ctx.addRate(cookie, { countryCode: 'US', priceCents: 500 });
    const del = await ctx.call('DELETE', `/api/admin/shipping-rates/${us.id}`, { cookie });
    assert.equal(del.status, 204);
    assert.deepEqual(await rates(cookie), []);
    assert.equal((await ctx.row('SELECT COUNT(*) AS n FROM shipping_rates')).n, 0);
    assert.equal((await ctx.call('DELETE', `/api/admin/shipping-rates/${us.id}`, { cookie })).status, 404);
  });
});
