import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../server/index.js';

test('health is JSON liveness and never accesses DB or assets', async () => {
  const env = new Proxy({}, { get() { throw new Error('unexpected binding access'); } });
  const response = await worker.fetch(new Request('https://example.test/api/health'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const data = await response.json();
  assert.equal(data.mode, 'demo');
  assert.equal(data.database_connected, false);
});
test('HEAD is bodyless and unsupported health methods are rejected', async () => {
  const head = await worker.fetch(new Request('https://example.test/api/health', {method:'HEAD'}), {});
  assert.equal(await head.text(), '');
  const post = await worker.fetch(new Request('https://example.test/api/health', {method:'POST'}), {});
  assert.equal(post.status, 405);
});
test('all unimplemented API routes fail closed without touching bindings', async () => {
  for (const path of ['/api', '/api/import', '/api/clients', '/api/health/']) {
    const response = await worker.fetch(new Request('https://example.test' + path), {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'data_api_not_enabled');
  }
});
test('non-API routes delegate to static assets', async () => {
  const request = new Request('https://example.test/dashboard');
  const response = await worker.fetch(request, {ASSETS:{fetch(r){
    assert.equal(r, request); return new Response('app');
  }}});
  assert.equal(await response.text(), 'app');
});
