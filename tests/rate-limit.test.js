process.env.RATE_LIMIT_MAX = '3';

const assert = (await import('node:assert/strict')).default;
const { describe, test } = await import('node:test');
const { setupSuite } = await import('./helpers.js');

const ctx = setupSuite();
const MAX = 3;

const limited = {
  '/api/auth/signup': (i) => ({ email: `user${i}@example.com`, password: 'long-enough-pw', name: 'U' }),
  '/api/auth/login': (i) => ({ email: `user${i}@example.com`, password: 'wrong-password' }),
  '/api/auth/forgot-password': (i) => ({ email: `user${i}@example.com` }),
  '/api/auth/resend-verification': (i) => ({ email: `user${i}@example.com` }),
};

describe('rate limit (RATE_LIMIT_MAX=3 per IP)', () => {
  for (const [path, body] of Object.entries(limited)) {
    test(`POST ${path} allows ${MAX} requests then answers 429 with Retry-After`, async () => {
      for (let i = 0; i < MAX; i++) {
        const res = await ctx.call('POST', path, { body: body(i) });
        assert.notEqual(res.status, 429, `request ${i + 1} should not be limited`);
      }
      const blocked = await ctx.call('POST', path, { body: body(MAX) });
      assert.equal(blocked.status, 429);
      assert.ok(blocked.body.error);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    });
  }

  test('unlisted endpoints are not limited', async () => {
    for (let i = 0; i < MAX + 2; i++) {
      assert.notEqual((await ctx.call('GET', '/api/auth/me')).status, 429);
    }
  });
});
