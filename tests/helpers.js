import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { afterEach, after, beforeEach } from 'node:test';

const realFetch = globalThis.fetch;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const PASSWORD = 'correct-horse-battery';
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// Full Set-Cookie header for a named cookie, or null.
export function setCookieOf(res, name) {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? null;
}

// "name=value" pair ready to send back in a Cookie header, or null.
export function cookiePair(res, name) {
  return setCookieOf(res, name)?.split(';')[0] ?? null;
}

export async function listen(app) {
  const server = app.listen(0);
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

export function closeServer(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

// Request that never follows redirects. `res` is the raw Response; `body` the parsed JSON (or null).
export async function send(base, method, path, { body, cookie, headers } = {}) {
  const res = await realFetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body (redirects)
  }
  return { status: res.status, body: json, headers: res.headers, res };
}

export function tokenFromMail(entry) {
  return JSON.stringify(entry).match(/token=([A-Za-z0-9_-]+)/)?.[1];
}

// Unsigned JWT: the server gets it straight from Google over TLS, so no signature check is expected.
export function idToken(overrides = {}) {
  const payload = {
    iss: 'https://accounts.google.com',
    aud: process.env.GOOGLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'google-sub-1',
    email: 'gina@example.com',
    email_verified: true,
    name: 'Gina Google',
    ...overrides,
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

// Replaces global fetch so only Google's token endpoint is faked.
export function stubGoogleToken({ status = 200, claims = {}, body } = {}) {
  globalThis.fetch = async (url, init) => {
    if (String(url) !== GOOGLE_TOKEN_URL) return realFetch(url, init);
    const payload = body ?? { id_token: idToken(claims), access_token: 'at' };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

// Registers hooks in the calling file: fresh tables, outbox and server per test.
export function setupSuite() {
  const ctx = {};

  beforeEach(async () => {
    const { pool } = await import('../src/db.js');
    const { outbox } = await import('../src/services/mailer.js');
    const { createApp } = await import('../src/app.js');
    ctx.pool = pool;
    ctx.outbox = outbox;
    outbox.length = 0;
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['sessions', 'auth_tokens', 'users']) await pool.query(`TRUNCATE TABLE ${table}`);
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    const { server, base } = await listen(createApp());
    ctx.server = server;
    ctx.base = base;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    await closeServer(ctx.server);
  });

  after(() => ctx.pool?.end());

  ctx.call = (method, path, options) => send(ctx.base, method, path, options);

  ctx.signup = (email, { password = PASSWORD, name = 'Ada Lovelace', ...extra } = {}) =>
    ctx.call('POST', '/api/auth/signup', { body: { email, password, name, ...extra } });

  ctx.login = (email, password = PASSWORD) =>
    ctx.call('POST', '/api/auth/login', { body: { email, password } });

  ctx.lastToken = (email) => {
    const mail = ctx.outbox.findLast((m) => JSON.stringify(m).includes(email));
    return mail && tokenFromMail(mail);
  };

  // Signs up and (by default) verifies through the real endpoints.
  ctx.createUser = async (email = 'ada@example.com', { verified = true, ...rest } = {}) => {
    await ctx.signup(email, rest);
    if (verified) {
      await ctx.call('POST', '/api/auth/verify-email', { body: { token: ctx.lastToken(email) } });
    }
    return { email, password: rest.password ?? PASSWORD };
  };

  // Verified user with a Google id, no password, and a live session. Returns the session cookie pair.
  ctx.createGoogleOnlyUser = async (email = 'goog@example.com') => {
    const [{ insertId }] = await ctx.pool.query(
      'INSERT INTO users (email, name, google_id, email_verified) VALUES (?, ?, ?, 1)',
      [email, 'Gina Google', `gid-${email}`],
    );
    const token = randomBytes(32).toString('base64url');
    await ctx.pool.query(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)',
      [insertId, sha256(token)],
    );
    return `session=${token}`;
  };

  // Logs in and returns the raw "session=..." cookie pair.
  ctx.signIn = async (email, password = PASSWORD) => cookiePair(await ctx.login(email, password), 'session');

  ctx.row = async (sql, params = []) => (await ctx.pool.query(sql, params))[0][0];

  ctx.forgotAndGetToken = async (email) => {
    await ctx.call('POST', '/api/auth/forgot-password', { body: { email } });
    return ctx.lastToken(email);
  };

  return ctx;
}
