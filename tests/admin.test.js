import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import express from 'express';
import { closeServer, listen, send, setupSuite } from './helpers.js';

const ctx = setupSuite();

describe('is_admin can never be set through the API', () => {
  const attempts = { isAdmin: true, is_admin: true, role: 'admin', admin: 1 };

  test('signup ignores admin fields in the body', async () => {
    await ctx.createUser('ada@example.com', attempts);
    assert.equal((await ctx.row('SELECT is_admin FROM users')).is_admin, 0);
    const me = await ctx.call('GET', '/api/auth/me', { cookie: await ctx.signIn('ada@example.com') });
    assert.equal(me.body.user.isAdmin, false);
  });

  test('reset-password and change-password ignore admin fields', async () => {
    await ctx.createUser('ada@example.com');
    const cookie = await ctx.signIn('ada@example.com');
    await ctx.call('POST', '/api/auth/change-password', {
      cookie,
      body: { currentPassword: 'correct-horse-battery', newPassword: 'another-long-password', ...attempts },
    });
    const token = await ctx.forgotAndGetToken('ada@example.com');
    await ctx.call('POST', '/api/auth/reset-password', {
      body: { token, password: 'yet-another-password', ...attempts },
    });
    assert.equal((await ctx.row('SELECT is_admin FROM users')).is_admin, 0);
  });
});

describe('requireAdmin', () => {
  let probe;
  after(() => probe && closeServer(probe.server));

  async function probeServer() {
    if (probe) return probe;
    const { requireAdmin } = await import('../src/middleware/requireAdmin.js');
    const { errorHandler } = await import('../src/middleware/errorHandler.js');
    const app = express();
    app.get('/admin-only', requireAdmin, (req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    probe = await listen(app);
    return probe;
  }

  const hit = async (cookie) => {
    const { base } = await probeServer();
    return send(base, 'GET', '/admin-only', { cookie });
  };

  test('401 without a session', async () => {
    assert.equal((await hit()).status, 401);
  });

  test('403 for a normal user', async () => {
    await ctx.createUser('ada@example.com');
    assert.equal((await hit(await ctx.signIn('ada@example.com'))).status, 403);
  });

  test('passes for an admin', async () => {
    await ctx.createUser('ada@example.com');
    await ctx.pool.query('UPDATE users SET is_admin = 1');
    const cookie = await ctx.signIn('ada@example.com');
    const res = await hit(cookie);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    const me = await ctx.call('GET', '/api/auth/me', { cookie });
    assert.equal(me.body.user.isAdmin, true);
  });
});
