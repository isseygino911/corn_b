import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PASSWORD, cookiePair, setCookieOf, setupSuite, stubGoogleToken } from './helpers.js';

const ctx = setupSuite();
const loginError = (code) => `${process.env.APP_URL}/login?error=${code}`;
const userCount = async () => (await ctx.row('SELECT COUNT(*) AS n FROM users')).n;

async function beginGoogle() {
  const res = await ctx.call('GET', '/api/auth/google');
  const url = new URL(res.headers.get('location'));
  return { res, url, state: url.searchParams.get('state'), cookie: cookiePair(res.res, 'g_oauth') };
}

function callback({ state, cookie }, { stateParam = state } = {}) {
  return ctx.call('GET', `/api/auth/google/callback?code=auth-code&state=${stateParam}`, { cookie });
}

describe('GET /google', () => {
  test('redirects to Google with PKCE S256 and state, storing them in a short-lived httpOnly cookie', async () => {
    const { res, url, state } = await beginGoogle();
    assert.equal(res.status, 302);
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
    assert.equal(url.searchParams.get('redirect_uri'), process.env.GOOGLE_REDIRECT_URI);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('code_challenge'));
    assert.ok(state);

    const cookie = setCookieOf(res.res, 'g_oauth');
    assert.match(cookie, /;\s*HttpOnly/i);
    assert.match(cookie, /;\s*Max-Age=600/i);
  });
});

describe('GET /google/callback', () => {
  test('creates a verified, password-less, non-admin user and signs them in', async () => {
    stubGoogleToken();
    const res = await callback(await beginGoogle());
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${process.env.APP_URL}/`);

    const user = await ctx.row('SELECT * FROM users');
    assert.equal(user.email, 'gina@example.com');
    assert.equal(user.name, 'Gina Google');
    assert.equal(user.email_verified, 1);
    assert.equal(user.password_hash, null);
    assert.equal(user.is_admin, 0);
    assert.equal(user.google_id, 'google-sub-1');

    const me = await ctx.call('GET', '/api/auth/me', { cookie: cookiePair(res.res, 'session') });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'gina@example.com');
    assert.equal(me.body.user.isAdmin, false);
  });

  test('links to the existing same-email user and keeps their password', async () => {
    await ctx.createUser('gina@example.com');
    const before = await ctx.row('SELECT id FROM users');
    stubGoogleToken();
    const res = await callback(await beginGoogle());
    assert.equal(res.headers.get('location'), `${process.env.APP_URL}/`);

    assert.equal(await userCount(), 1);
    const user = await ctx.row('SELECT * FROM users');
    assert.equal(user.id, before.id);
    assert.equal(user.google_id, 'google-sub-1');
    assert.equal(user.is_admin, 0);
    assert.equal((await ctx.login('gina@example.com', PASSWORD)).status, 200);
  });

  test('does not grant admin even if the id_token carries admin-looking claims', async () => {
    await ctx.createUser('gina@example.com');
    stubGoogleToken({ claims: { is_admin: true, role: 'admin' } });
    await callback(await beginGoogle());
    assert.equal((await ctx.row('SELECT is_admin FROM users')).is_admin, 0);
  });

  test('redirects to google_unverified when Google says the email is unverified, creating nothing', async () => {
    stubGoogleToken({ claims: { email_verified: false } });
    const res = await callback(await beginGoogle());
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), loginError('google_unverified'));
    assert.equal(setCookieOf(res.res, 'session'), null);
    assert.equal(await userCount(), 0);
  });

  const failures = {
    'state does not match the cookie': async () => callback(await beginGoogle(), { stateParam: 'forged-state' }),
    'the g_oauth cookie is missing': async () => callback({ ...(await beginGoogle()), cookie: undefined }),
    'Google rejects the code exchange': async () => {
      stubGoogleToken({ status: 400, body: { error: 'invalid_grant' } });
      return callback(await beginGoogle());
    },
    'the id_token audience is not our client': async () => {
      stubGoogleToken({ claims: { aud: 'someone-elses-client' } });
      return callback(await beginGoogle());
    },
    'the id_token issuer is wrong': async () => {
      stubGoogleToken({ claims: { iss: 'https://evil.example.com' } });
      return callback(await beginGoogle());
    },
    'the id_token is expired': async () => {
      stubGoogleToken({ claims: { exp: Math.floor(Date.now() / 1000) - 60 } });
      return callback(await beginGoogle());
    },
  };
  for (const [label, run] of Object.entries(failures)) {
    test(`redirects to ?error=google, with no user or session, when ${label}`, async () => {
      stubGoogleToken();
      const res = await run();
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), loginError('google'));
      assert.equal(setCookieOf(res.res, 'session'), null);
      assert.equal(await userCount(), 0);
    });
  }
});
