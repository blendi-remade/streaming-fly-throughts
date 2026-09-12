import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/brain/route';

const request = (body: string, origin = 'http://127.0.0.1:3000') => new Request('http://localhost:3000/api/brain', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Host: '127.0.0.1:3000', Origin: origin }, body,
});

test('brain acknowledgement remains one upstream write and includes a receipt timestamp for fresh observation', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; options?: RequestInit }[] = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return Response.json({ accepted: true, kind: 'sugar' }, { status: 202 });
  };
  try {
    const before = Date.now();
    const response = await POST(request(JSON.stringify({ kind: 'sugar', intensity: 0.85, durationMs: 10000 })));
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.accepted, true);
    assert.ok(body.acceptedAt >= before && body.acceptedAt <= Date.now());
    assert.equal(body.snapshot, undefined, 'queue acknowledgement must not fabricate an observed snapshot');
    assert.equal(calls.length, 1, 'the proxy must not add competing state reads');
    assert.match(calls[0].url, /\/stimulus$/);
    assert.equal(calls[0].options?.method, 'POST');
  } finally { globalThis.fetch = original; }
});

test('invalid JSON and foreign origins fail before any upstream brain write', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected upstream call'); };
  try {
    for (const body of ['{', 'null', '[]']) assert.equal((await POST(request(body))).status, 400);
    assert.equal((await POST(request('{"kind":"sugar"}', 'https://example.com'))).status, 403);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
