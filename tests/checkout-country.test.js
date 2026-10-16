import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { line, setupStoreSuite } from './storefrontHelpers.js';

const ctx = setupStoreSuite();

const quote = (items, countryCode) => ctx.call('POST', '/api/checkout/quote', { body: { items, countryCode } });

describe('checkout quote countryCode validation', () => {
  test('ignored entirely while shipping is off, even a bogus code', async () => {
    const admin = await ctx.adminCookie();
    const charm = await ctx.makeProduct(admin);
    for (const code of ['ZZ', 'nonsense', 42]) {
      const res = await quote([line(charm)], code);
      assert.equal(res.status, 200, String(code));
      assert.equal(res.body.shippingCents, 0);
    }
  });

  test('an unknown code is 400 while shipping is on', async () => {
    const admin = await ctx.adminCookie();
    const charm = await ctx.makeProduct(admin);
    await ctx.setSettings(admin, { shippingEnabled: true });
    await ctx.addRate(admin, { priceCents: 1500 });
    assert.equal((await quote([line(charm)], 'ZZ')).status, 400);
    assert.equal((await quote([line(charm)], 'GB')).status, 200);
  });
});
