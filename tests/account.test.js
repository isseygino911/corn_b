import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { list, setupSuite } from './helpers.js';

const ctx = setupSuite();

const ADDRESS = {
  fullName: 'Ada Lovelace',
  phone: '555-0100',
  line1: '1 Main St',
  countryCode: 'US',
  stateCode: 'CA',
  city: 'Los Angeles',
  postalCode: '90001',
};
const ADDRESS_ROUTES = [
  ['GET', '/api/account/addresses'],
  ['POST', '/api/account/addresses'],
  ['PATCH', '/api/account/addresses/1'],
  ['DELETE', '/api/account/addresses/1'],
  ['POST', '/api/account/addresses/1/default'],
  ['PATCH', '/api/account/profile'],
];

const addr = (body) => body.address;
const addresses = async (cookie) => list((await ctx.call('GET', '/api/account/addresses', { cookie })).body, 'addresses');
const create = (cookie, overrides = {}) =>
  ctx.call('POST', '/api/account/addresses', { cookie, body: { ...ADDRESS, ...overrides } });

describe('account auth', () => {
  for (const [method, path] of ADDRESS_ROUTES) {
    test(`${method} ${path} is 401 signed out`, async () => {
      assert.equal((await ctx.call(method, path, { body: method === 'GET' ? undefined : {} })).status, 401);
    });
  }
});

describe('profile', () => {
  test('updates the name and returns the unchanged user shape', async () => {
    const cookie = await ctx.cookieFor('ada@example.com');
    const res = await ctx.call('PATCH', '/api/account/profile', { cookie, body: { name: 'Ada B' } });
    assert.equal(res.status, 200);
    const user = res.body.user;
    assert.deepEqual(Object.keys(user).sort(), ['email', 'id', 'isAdmin', 'name']);
    assert.equal(user.name, 'Ada B');
    assert.equal((await ctx.call('GET', '/api/auth/me', { cookie })).body.user.name, 'Ada B');
  });

  test('rejects an empty or >80 char name; email and admin flag cannot change', async () => {
    const cookie = await ctx.cookieFor('ada@example.com');
    for (const name of ['', '   ', 'x'.repeat(81), undefined]) {
      assert.equal((await ctx.call('PATCH', '/api/account/profile', { cookie, body: { name } })).status, 400);
    }
    await ctx.call('PATCH', '/api/account/profile', {
      cookie,
      body: { name: 'Ok', email: 'evil@example.com', isAdmin: true, is_admin: 1 },
    });
    const row = await ctx.row('SELECT email, is_admin FROM users');
    assert.equal(row.email, 'ada@example.com');
    assert.equal(row.is_admin, 0);
  });
});

describe('addresses', () => {
  test('create, list, update; first becomes default, second does not', async () => {
    const cookie = await ctx.cookieFor('ada@example.com');
    const first = await create(cookie);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(addr(first.body).isDefault, true);
    const second = await create(cookie, { line1: '2 Side St' });
    assert.equal(addr(second.body).isDefault, false);
    assert.equal((await addresses(cookie)).length, 2);
    const patch = await ctx.call('PATCH', `/api/account/addresses/${addr(second.body).id}`, {
      cookie,
      body: { line1: '3 New St', line2: 'Apt 4' },
    });
    assert.equal(patch.status, 200);
    assert.equal(addr(patch.body).line1, '3 New St');
  });

  test('POST :id/default moves the single default', async () => {
    const cookie = await ctx.cookieFor('ada@example.com');
    await create(cookie);
    const second = addr((await create(cookie, { line1: '2 Side St' })).body);
    const res = await ctx.call('POST', `/api/account/addresses/${second.id}/default`, { cookie });
    assert.equal(res.status, 200);
    const defaults = (await addresses(cookie)).filter((a) => a.isDefault);
    assert.deepEqual(defaults.map((a) => a.id), [second.id]);
  });

  test('deleting the default promotes the oldest remaining', async () => {
    const cookie = await ctx.cookieFor('ada@example.com');
    const first = addr((await create(cookie)).body);
    const second = addr((await create(cookie, { line1: '2' })).body);
    await create(cookie, { line1: '3' });
    assert.equal((await ctx.call('DELETE', `/api/account/addresses/${first.id}`, { cookie })).status, 200);
    const rest = await addresses(cookie);
    assert.equal(rest.length, 2);
    assert.deepEqual(rest.filter((a) => a.isDefault).map((a) => a.id), [second.id]);
    for (const a of rest) await ctx.call('DELETE', `/api/account/addresses/${a.id}`, { cookie });
    assert.equal((await addresses(cookie)).length, 0);
  });

  test('11th address is rejected (cap 10)', async () => {
    const cookie = await ctx.cookieFor('ada@example.com');
    for (let i = 0; i < 10; i++) assert.equal((await create(cookie, { line1: `${i} St` })).status, 201);
    assert.equal((await create(cookie, { line1: 'eleventh' })).status, 400);
    assert.equal((await addresses(cookie)).length, 10);
  });

  test("another user's rows are 404 for read-modify-delete-default and absent from the list", async () => {
    const ada = await ctx.cookieFor('ada@example.com');
    const bob = await ctx.cookieFor('bob@example.com');
    const mine = addr((await create(ada)).body);
    assert.equal((await addresses(bob)).length, 0);
    assert.equal((await ctx.call('PATCH', `/api/account/addresses/${mine.id}`, { cookie: bob, body: { city: 'X' } })).status, 404);
    assert.equal((await ctx.call('DELETE', `/api/account/addresses/${mine.id}`, { cookie: bob })).status, 404);
    assert.equal((await ctx.call('POST', `/api/account/addresses/${mine.id}/default`, { cookie: bob })).status, 404);
    assert.equal((await addresses(ada)).length, 1);
    assert.equal((await addresses(ada))[0].city, 'Los Angeles');
  });

  test('validates required fields, country and state against geo data', async () => {
    const cookie = await ctx.cookieFor('ada@example.com');
    for (const bad of [
      { fullName: '' },
      { line1: '' },
      { postalCode: '' },
      { countryCode: 'ZZ' },
      { stateCode: 'ZZ' },
      { countryCode: 'CA' }, // CA the country does not have state "CA"
    ]) {
      assert.equal((await create(cookie, bad)).status, 400, JSON.stringify(bad));
    }
    const mine = addr((await create(cookie)).body);
    const patch = await ctx.call('PATCH', `/api/account/addresses/${mine.id}`, { cookie, body: { stateCode: 'ZZ' } });
    assert.equal(patch.status, 400);
  });

  test('city is free text when the state has no cities', async () => {
    const cookie = await ctx.cookieFor('ada@example.com');
    const { list: l } = await import('./helpers.js');
    const countries = l((await ctx.call('GET', '/api/geo/countries')).body, 'countries');
    for (const c of countries.slice(0, 250)) {
      const code = c.code;
      const states = l((await ctx.call('GET', `/api/geo/states?country=${code}`)).body, 'states');
      for (const s of states.slice(0, 40)) {
        const sc = s.code;
        const cities = l((await ctx.call('GET', `/api/geo/cities?country=${code}&state=${sc}`)).body, 'cities');
        if (cities.length === 0) {
          const res = await create(cookie, { countryCode: code, stateCode: sc, city: 'Any Free Text Town' });
          assert.equal(res.status, 201, `${code}/${sc}`);
          return;
        }
      }
    }
  });
});
