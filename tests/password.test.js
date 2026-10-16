import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PASSWORD, setupSuite } from './helpers.js';

const ctx = setupSuite();
const NEW_PASSWORD = 'a-brand-new-password';
const me = (cookie) => ctx.call('GET', '/api/auth/me', { cookie });
const forgot = (email) => ctx.call('POST', '/api/auth/forgot-password', { body: { email } });
const reset = (token, password = NEW_PASSWORD) =>
  ctx.call('POST', '/api/auth/reset-password', { body: { token, password } });

describe('forgot-password', () => {
  test('sends a reset link to an existing user', async () => {
    await ctx.createUser('ada@example.com');
    ctx.outbox.length = 0;
    const res = await forgot('ada@example.com');
    assert.equal(res.status, 200);
    assert.equal(ctx.outbox.length, 1);
    assert.ok(JSON.stringify(ctx.outbox[0]).includes(`${process.env.APP_URL}/reset-password?token=`));
  });

  test('answers an unknown email identically and sends nothing', async () => {
    await ctx.createUser('ada@example.com');
    ctx.outbox.length = 0;
    const known = await forgot('ada@example.com');
    const unknown = await forgot('ghost@example.com');
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body, known.body);
    assert.equal(ctx.outbox.length, 1);
  });

  test('rejects an invalid email with 400', async () => {
    assert.equal((await forgot('nope')).status, 400);
  });
});

describe('reset-password', () => {
  test('sets the new password, revokes ALL sessions and rejects the old password', async () => {
    await ctx.createUser('ada@example.com');
    const a = await ctx.signIn('ada@example.com');
    const b = await ctx.signIn('ada@example.com');
    const res = await reset(await ctx.forgotAndGetToken('ada@example.com'));
    assert.equal(res.status, 200);
    assert.ok(res.body.message);

    assert.equal((await me(a)).status, 401);
    assert.equal((await me(b)).status, 401);
    assert.equal((await ctx.login('ada@example.com', PASSWORD)).status, 401);
    assert.equal((await ctx.login('ada@example.com', NEW_PASSWORD)).status, 200);
  });

  test('marks the email verified so an unverified user can then log in', async () => {
    await ctx.createUser('ada@example.com', { verified: false });
    await reset(await ctx.forgotAndGetToken('ada@example.com'));
    assert.equal((await ctx.row('SELECT email_verified FROM users')).email_verified, 1);
    assert.equal((await ctx.login('ada@example.com', NEW_PASSWORD)).status, 200);
  });

  test('token is single use', async () => {
    await ctx.createUser('ada@example.com');
    const token = await ctx.forgotAndGetToken('ada@example.com');
    assert.equal((await reset(token)).status, 200);
    assert.equal((await reset(token, 'yet-another-password')).status, 400);
    assert.equal((await ctx.login('ada@example.com', NEW_PASSWORD)).status, 200);
  });

  test('rejects an unknown token', async () => {
    assert.equal((await reset('nope')).status, 400);
  });

  test('token lasts 1h and is rejected once expired', async () => {
    await ctx.createUser('ada@example.com');
    const token = await ctx.forgotAndGetToken('ada@example.com');
    const { seconds } = await ctx.row(
      "SELECT TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS seconds FROM auth_tokens WHERE type = 'reset'",
    );
    assert.ok(seconds > 3600 - 120 && seconds <= 3600, `expires in ${seconds}s`);
    await ctx.pool.query("UPDATE auth_tokens SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE type = 'reset'");
    assert.equal((await reset(token)).status, 400);
  });

  test('rejects an invalid new password with 400 and keeps the token usable', async () => {
    await ctx.createUser('ada@example.com');
    const token = await ctx.forgotAndGetToken('ada@example.com');
    assert.equal((await reset(token, 'short')).status, 400);
    assert.equal((await reset(token)).status, 200);
  });

  test('requesting a new reset invalidates the earlier token', async () => {
    await ctx.createUser('ada@example.com');
    const first = await ctx.forgotAndGetToken('ada@example.com');
    const second = await ctx.forgotAndGetToken('ada@example.com');
    assert.notEqual(first, second);
    assert.equal((await reset(first)).status, 400);
    assert.equal((await reset(second)).status, 200);
  });

  test('a verify token cannot be used as a reset token', async () => {
    await ctx.signup('ada@example.com');
    assert.equal((await reset(ctx.lastToken('ada@example.com'))).status, 400);
  });
});

describe('change-password', () => {
  const change = (cookie, currentPassword = PASSWORD, newPassword = NEW_PASSWORD) =>
    ctx.call('POST', '/api/auth/change-password', { cookie, body: { currentPassword, newPassword } });

  test('401 without a session', async () => {
    assert.equal((await change(undefined)).status, 401);
  });

  test('changes the password, revokes other sessions and keeps the current one', async () => {
    await ctx.createUser('ada@example.com');
    const current = await ctx.signIn('ada@example.com');
    const other = await ctx.signIn('ada@example.com');
    const res = await change(current);
    assert.equal(res.status, 200);
    assert.ok(res.body.message);

    assert.equal((await me(current)).status, 200);
    assert.equal((await me(other)).status, 401);
    assert.equal((await ctx.login('ada@example.com', PASSWORD)).status, 401);
    assert.equal((await ctx.login('ada@example.com', NEW_PASSWORD)).status, 200);
  });

  test('400 for a wrong current password, leaving the password unchanged', async () => {
    await ctx.createUser('ada@example.com');
    const cookie = await ctx.signIn('ada@example.com');
    assert.equal((await change(cookie, 'not-my-password')).status, 400);
    assert.equal((await ctx.login('ada@example.com', PASSWORD)).status, 200);
  });

  test('400 for an invalid new password', async () => {
    await ctx.createUser('ada@example.com');
    const cookie = await ctx.signIn('ada@example.com');
    assert.equal((await change(cookie, PASSWORD, 'short')).status, 400);
  });

  test('400 for a user with no password (Google-only)', async () => {
    const cookie = await ctx.createGoogleOnlyUser();
    assert.equal((await change(cookie)).status, 400);
  });
});
