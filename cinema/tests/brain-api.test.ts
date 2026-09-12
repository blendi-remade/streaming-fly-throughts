import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin } from '../lib/brain-api';

test('brain writes accept the actual loopback host when Next normalizes its request URL', () => {
  const request = new Request('http://localhost:3000/api/brain', {
    headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(allowedOrigin(request), true);
});

test('brain writes reject foreign origins and ports', () => {
  for (const origin of ['https://example.com', 'http://127.0.0.1:3001', 'http://localhost:3000']) {
    assert.equal(allowedOrigin(new Request('http://localhost:3000/api/brain', {
      headers: { host: '127.0.0.1:3000', origin },
    })), false);
  }
});

test('brain writes require a local browser origin', () => {
  assert.equal(allowedOrigin(new Request('http://127.0.0.1:3000/api/brain')), false);
  assert.equal(allowedOrigin(new Request('http://example.com/api/brain', {
    headers: { host: 'example.com', origin: 'http://example.com' },
  })), false);
});
