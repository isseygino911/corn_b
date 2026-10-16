import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setupSuite } from './helpers.js';

const ctx = setupSuite();
const origin = () => process.env.APP_URL;

describe('CORS', () => {
  test('the app origin gets credentialed CORS headers on a normal request', async () => {
    const { status, headers } = await ctx.call('GET', '/api/health', { headers: { origin: origin() } });
    assert.equal(status, 200);
    assert.equal(headers.get('access-control-allow-origin'), origin());
    assert.equal(headers.get('access-control-allow-credentials'), 'true');
    assert.match(headers.get('vary'), /Origin/);
  });

  test('a preflight from the app origin is answered 204 with methods and headers', async () => {
    const { status, headers } = await ctx.call('OPTIONS', '/api/orders', {
      headers: { origin: origin(), 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    assert.equal(status, 204);
    assert.equal(headers.get('access-control-allow-origin'), origin());
    assert.match(headers.get('access-control-allow-methods'), /PATCH/);
    assert.match(headers.get('access-control-allow-headers'), /Content-Type/i);
  });

  test('another origin gets no CORS headers', async () => {
    const { headers } = await ctx.call('GET', '/api/health', { headers: { origin: 'https://evil.example' } });
    assert.equal(headers.get('access-control-allow-origin'), null);
    assert.equal(headers.get('access-control-allow-credentials'), null);
  });

  test('a request without an Origin header gets no CORS headers', async () => {
    const { headers } = await ctx.call('GET', '/api/health');
    assert.equal(headers.get('access-control-allow-origin'), null);
  });
});
