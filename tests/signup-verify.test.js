import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PASSWORD, setupSuite } from './helpers.js';

const ctx = setupSuite();
const verifyUrl = () => `${process.env.APP_URL}/verify-email?token=`;

describe('signup', () => {
  test('creates an unverified user with a hashed password and sends a verify link', async () => {
    const res = await ctx.signup('  Ada@Example.COM ');
    assert.equal(res.status, 201);
    assert.ok(res.body.message);

    const user = await ctx.row('SELECT * FROM users');
    assert.equal(user.email, 'ada@example.com');
    assert.equal(user.name, 'Ada Lovelace');
    assert.equal(user.email_verified, 0);
    assert.equal(user.is_admin, 0);
    assert.ok(user.password_hash);
    assert.ok(!user.password_hash.includes(PASSWORD));

    assert.equal(ctx.outbox.length, 1);
    assert.ok(JSON.stringify(ctx.outbox[0]).includes(verifyUrl()));
  });

  test('rejects a duplicate email regardless of case with 409', async () => {
    await ctx.signup('ada@example.com');
    const res = await ctx.signup('ADA@example.com');
    assert.equal(res.status, 409);
    assert.ok(res.body.error);
  });

  const invalid = {
    'malformed email': ['not-an-email', {}],
    'password of 7 chars': ['a@example.com', { password: 'a'.repeat(7) }],
    'password of 129 chars': ['a@example.com', { password: 'a'.repeat(129) }],
    'empty name': ['a@example.com', { name: '' }],
    'name of 81 chars': ['a@example.com', { name: 'n'.repeat(81) }],
  };
  for (const [label, [email, opts]] of Object.entries(invalid)) {
    test(`rejects ${label} with 400 and creates nothing`, async () => {
      const res = await ctx.signup(email, opts);
      assert.equal(res.status, 400);
      assert.ok(res.body.error);
      assert.equal((await ctx.row('SELECT COUNT(*) AS n FROM users')).n, 0);
    });
  }

  test('accepts boundary lengths (8-char password, 80-char name)', async () => {
    const res = await ctx.signup('a@example.com', { password: 'a'.repeat(8), name: 'n'.repeat(80) });
    assert.equal(res.status, 201);
  });
});

describe('verify-email', () => {
  const verify = (token) => ctx.call('POST', '/api/auth/verify-email', { body: { token } });

  test('marks the email verified', async () => {
    await ctx.signup('ada@example.com');
    const res = await verify(ctx.lastToken('ada@example.com'));
    assert.equal(res.status, 200);
    assert.ok(res.body.message);
    assert.equal((await ctx.row('SELECT email_verified FROM users')).email_verified, 1);
  });

  test('rejects an unknown token', async () => {
    const res = await verify('nope');
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('rejects an expired token and leaves the user unverified', async () => {
    await ctx.signup('ada@example.com');
    const token = ctx.lastToken('ada@example.com');
    await ctx.pool.query("UPDATE auth_tokens SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE type = 'verify'");
    assert.equal((await verify(token)).status, 400);
    assert.equal((await ctx.row('SELECT email_verified FROM users')).email_verified, 0);
  });

  test('rejects a reused token', async () => {
    await ctx.signup('ada@example.com');
    const token = ctx.lastToken('ada@example.com');
    assert.equal((await verify(token)).status, 200);
    assert.equal((await verify(token)).status, 400);
  });

  test('stores only a hash of the token', async () => {
    await ctx.signup('ada@example.com');
    const token = ctx.lastToken('ada@example.com');
    const row = await ctx.row("SELECT token_hash FROM auth_tokens WHERE type = 'verify'");
    assert.notEqual(row.token_hash, token);
    assert.equal(row.token_hash.length, 64);
  });
});

describe('resend-verification', () => {
  const resend = (email) => ctx.call('POST', '/api/auth/resend-verification', { body: { email } });

  test('sends a new mail for an unverified user and invalidates the old token', async () => {
    await ctx.signup('ada@example.com');
    const oldToken = ctx.lastToken('ada@example.com');
    const res = await resend('ada@example.com');
    assert.equal(res.status, 200);
    assert.equal(ctx.outbox.length, 2);

    const verify = (token) => ctx.call('POST', '/api/auth/verify-email', { body: { token } });
    assert.equal((await verify(oldToken)).status, 400);
    assert.equal((await verify(ctx.lastToken('ada@example.com'))).status, 200);
  });

  test('answers 200 without mail for unknown and already verified emails', async () => {
    await ctx.createUser('ada@example.com');
    const before = ctx.outbox.length;
    const unknown = await resend('ghost@example.com');
    const verified = await resend('ada@example.com');
    assert.equal(unknown.status, 200);
    assert.equal(verified.status, 200);
    assert.deepEqual(unknown.body, verified.body);
    assert.equal(ctx.outbox.length, before);
  });

  test('rejects an invalid email with 400', async () => {
    assert.equal((await resend('nope')).status, 400);
  });
});
