import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setCookieOf, setupSuite, sha256 } from './helpers.js';

const ctx = setupSuite();
const me = (cookie) => ctx.call('GET', '/api/auth/me', { cookie });
const secondsLeft = () =>
  ctx.row('SELECT TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS seconds FROM sessions').then((r) => r.seconds);

describe('login', () => {
  test('returns the user shape and sets a hardened 24h session cookie', async () => {
    await ctx.createUser('ada@example.com');
    const res = await ctx.login('ada@example.com');
    assert.equal(res.status, 200);
    const id = (await ctx.row('SELECT id FROM users')).id;
    assert.deepEqual(res.body, { user: { id, email: 'ada@example.com', name: 'Ada Lovelace', isAdmin: false } });

    const cookie = setCookieOf(res.res, 'session');
    assert.match(cookie, /;\s*HttpOnly/i);
    assert.match(cookie, /;\s*SameSite=Lax/i);
    assert.match(cookie, /;\s*Path=\//i);
    assert.match(cookie, /;\s*Max-Age=86400/i);
    assert.doesNotMatch(cookie, /;\s*Secure/i, 'Secure only in production');
  });

  test('stores only the sha256 of the session token', async () => {
    await ctx.createUser('ada@example.com');
    const pair = await ctx.signIn('ada@example.com');
    const row = await ctx.row('SELECT token_hash FROM sessions');
    assert.equal(row.token_hash, sha256(pair.slice('session='.length)));
  });

  test('matches email case-insensitively', async () => {
    await ctx.createUser('ada@example.com');
    assert.equal((await ctx.login('ADA@Example.com')).status, 200);
  });

  test('refuses an unverified account with 403 email_not_verified and no cookie', async () => {
    await ctx.createUser('ada@example.com', { verified: false });
    const res = await ctx.login('ada@example.com');
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'email_not_verified');
    assert.equal(setCookieOf(res.res, 'session'), null);
  });

  test('answers wrong password, unknown email and Google-only account identically with 401', async () => {
    await ctx.createUser('ada@example.com');
    await ctx.createGoogleOnlyUser('goog@example.com');
    const wrongPassword = await ctx.login('ada@example.com', 'wrong-password');
    const unknown = await ctx.login('ghost@example.com');
    const googleOnly = await ctx.login('goog@example.com');
    for (const res of [wrongPassword, unknown, googleOnly]) {
      assert.equal(res.status, 401);
      assert.equal(setCookieOf(res.res, 'session'), null);
    }
    assert.equal(unknown.body.error, wrongPassword.body.error);
    assert.equal(googleOnly.body.error, wrongPassword.body.error);
  });
});

describe('me', () => {
  test('returns the signed-in user', async () => {
    await ctx.createUser('ada@example.com');
    const res = await me(await ctx.signIn('ada@example.com'));
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'ada@example.com');
    assert.equal(res.body.user.isAdmin, false);
  });

  test('401 without a cookie', async () => {
    assert.equal((await me()).status, 401);
  });

  test('401 with an unknown session token', async () => {
    assert.equal((await me('session=not-a-real-token')).status, 401);
  });

  test('401 once the session has expired', async () => {
    await ctx.createUser('ada@example.com');
    const cookie = await ctx.signIn('ada@example.com');
    assert.equal((await me(cookie)).status, 200);
    await ctx.pool.query('UPDATE sessions SET expires_at = NOW() - INTERVAL 1 MINUTE');
    assert.equal((await me(cookie)).status, 401);
  });

  test('session lifetime is 24h from login and does not slide', async () => {
    await ctx.createUser('ada@example.com');
    const cookie = await ctx.signIn('ada@example.com');
    const initial = await secondsLeft();
    assert.ok(initial > 86400 - 120 && initial <= 86400, `expires in ${initial}s`);
    await me(cookie);
    assert.ok((await secondsLeft()) <= initial);
  });
});

describe('logout', () => {
  test('deletes the session, clears the cookie, and the cookie stops working', async () => {
    await ctx.createUser('ada@example.com');
    const cookie = await ctx.signIn('ada@example.com');
    const res = await ctx.call('POST', '/api/auth/logout', { cookie });
    assert.equal(res.status, 200);
    assert.ok(res.body.message);
    assert.match(setCookieOf(res.res, 'session'), /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    assert.equal((await ctx.row('SELECT COUNT(*) AS n FROM sessions')).n, 0);
    assert.equal((await me(cookie)).status, 401);
  });

  test('is idempotent without a session', async () => {
    assert.equal((await ctx.call('POST', '/api/auth/logout')).status, 200);
  });

  test('only ends the calling session', async () => {
    await ctx.createUser('ada@example.com');
    const first = await ctx.signIn('ada@example.com');
    const second = await ctx.signIn('ada@example.com');
    await ctx.call('POST', '/api/auth/logout', { cookie: first });
    assert.equal((await me(second)).status, 200);
  });
});

test('GET /api/health is ok', async () => {
  const res = await ctx.call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
