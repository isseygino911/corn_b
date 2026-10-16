import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { list, setupSuite } from './helpers.js';

const ctx = setupSuite();

describe('geo (public)', () => {
  test('countries: no auth, cache headers, includes US with a code and name', async () => {
    const res = await ctx.call('GET', '/api/geo/countries');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
    const countries = list(res.body, 'countries');
    assert.ok(countries.length > 100);
    const us = countries.find((c) => c.code === 'US');
    assert.ok(us, 'US present');
    assert.ok(us.name);
  });

  test('states by country; city list by state', async () => {
    const states = list((await ctx.call('GET', '/api/geo/states?country=US')).body, 'states');
    assert.ok(states.some((s) => s.code === 'CA'), 'California present');
    const cities = list((await ctx.call('GET', '/api/geo/cities?country=US&state=CA')).body, 'cities');
    assert.ok(cities.some((c) => c.name === 'Los Angeles'));
  });

  test('missing or unknown params', async () => {
    assert.equal((await ctx.call('GET', '/api/geo/states')).status, 400);
    assert.equal((await ctx.call('GET', '/api/geo/cities?country=US')).status, 400);
    const unknown = await ctx.call('GET', '/api/geo/states?country=ZZ');
    assert.ok(unknown.status === 400 || (unknown.status === 200 && list(unknown.body, 'states').length === 0));
  });
});
