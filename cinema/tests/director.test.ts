import test from "node:test";
import assert from "node:assert/strict";
import { interpretBrain } from "../lib/cinematic";
import { EMPTY_BRAIN, type BrainSnapshot } from "../lib/types";
import { parseDirectorInput } from "../lib/server/director-input";
import { assertLocalRequest, readBoundedJson } from "../lib/server/guards";
import { POST as direct } from "../app/api/director/route";
import { POST as proxy } from "../app/api/fal/proxy/route";
import { GET as config } from "../app/api/config/route";

const snapshot = (patch: Partial<BrainSnapshot> = {}): BrainSnapshot => ({
  ...EMPTY_BRAIN, source: "connectome", timestamp: Date.now(),
  populations: [{ name: "Sugar sensory", hz: 18, count: 30 }],
  motors: { forward: 0, yaw: 0, feed: 0, groom: 0, escape: 0, flight: 0 },
  ...patch,
});
const request = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://127.0.0.1:3000${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000", ...headers }, body: JSON.stringify(body),
});

test("cinematic drive follows readouts, not the stimulus label", () => {
  const noEscape = snapshot({ stimulus: { kind: "loom", intensity: 1, remainingMs: 5_000 } });
  assert.equal(interpretBrain(noEscape).drive, "rest");
  const escaping = snapshot({ motors: { ...noEscape.motors, escape: 0.9 } });
  assert.equal(interpretBrain(escaping).drive, "escape");
  assert.match(interpretBrain(escaping).evidence[0], /0\.900/);
});

test("synthetic preview is explicitly attributed and bitter does not prove suppression", () => {
  const result = interpretBrain(snapshot({ source: "preview", stimulus: { kind: "bitter", intensity: 1, remainingMs: 1_000 } }));
  assert.match(result.reason, /Synthetic preview/);
  assert.match(result.evidence.join(" "), /does not establish suppression/);
  assert.equal(result.translator, "deterministic");
});

test("sensory-only imagery follows measured population activity, preserving the motor drive", () => {
  const smell = interpretBrain(snapshot({ stimulus: { kind: "clear", intensity: 0, remainingMs: 0 }, populations: [{ name: "ORN_DM1", hz: 123, count: 74 }] }));
  assert.equal(smell.drive, "rest");
  assert.equal(smell.sensoryTheme, "odor");
  assert.match(smell.prompt, /amber scent wisps/);
  const bitter = interpretBrain(snapshot({ populations: [{ name: "Bitter GRNs", hz: 45, count: 38 }] }));
  assert.equal(bitter.drive, "rest");
  assert.equal(bitter.sensoryTheme, "bitter");
  assert.match(bitter.evidence.join(" "), /does not establish behavioral rejection/);
  const labelOnly = interpretBrain(snapshot({ stimulus: { kind: "odor", intensity: 1, remainingMs: 1000 } }));
  assert.equal(labelOnly.sensoryTheme, undefined);
});

test("validates finite telemetry and bounds history", () => {
  assert.equal(parseDirectorInput({ telemetry: snapshot(), initialization: 'fruit' }).initialization, 'fruit');
  assert.throws(() => parseDirectorInput({ telemetry: snapshot(), initialization: 'invented' }), /Invalid starting scene/);
  assert.equal(parseDirectorInput({ telemetry: snapshot(), history: [], start: true }).start, true);
  assert.equal(parseDirectorInput({ telemetry: snapshot() }).mode, "direct");
  assert.throws(() => parseDirectorInput({ telemetry: snapshot(), mode: "unknown" }), /Invalid translator mode/);
  assert.throws(() => parseDirectorInput({ telemetry: snapshot({ totalSpikes: Infinity }) }), /Invalid spike count/);
  assert.throws(() => parseDirectorInput({ telemetry: snapshot(), history: Array(7).fill("past scene") }), /at most six/);
  assert.throws(() => parseDirectorInput({ telemetry: snapshot({ populations: Array(65).fill({ name: "x", hz: 1, count: 1 }) }) }), /Invalid populations/);
});

test('secondary actions and sensory cues require measured evidence', () => {
  const baseline = snapshot({ motors: { ...EMPTY_BRAIN.motors, groom: 0.4 } });
  const labelOnly = interpretBrain({ ...baseline, stimulus: { kind: 'sugar', intensity: 1, remainingMs: 1000 } });
  assert.doesNotMatch(labelOnly.prompt, /concurrent measured feeding response|Measured sugar sensory activity/);
  const responding = interpretBrain({ ...baseline, motors: { ...baseline.motors, feed: 0.2 }, populations: [{ name: 'Sugar GRNs', count: 34, hz: 100 }] });
  assert.equal(responding.drive, 'groom');
  assert.notEqual(responding.responseKey, labelOnly.responseKey);
  assert.match(responding.prompt, /concurrent measured feeding response/);
  assert.match(responding.evidence.join(' '), /0.200/);
});

test("origin guard rejects cross-site, missing-origin and non-loopback writes", () => {
  assert.doesNotThrow(() => assertLocalRequest(request("/api/director", {})));
  assert.throws(() => assertLocalRequest(request("/api/director", {}, { Origin: "https://attacker.example" })), /Cross-origin/);
  assert.throws(() => assertLocalRequest(new Request("http://127.0.0.1:3000/api/director", { method: "POST" })), /same-origin/);
  assert.throws(() => assertLocalRequest(new Request("https://public.example/api/director", { headers: { Origin: "https://public.example" } })), /localhost only/);
});

test("streaming JSON limit applies without Content-Length", async () => {
  await assert.rejects(() => readBoundedJson(request("/api/director", { text: "x".repeat(1_000) }), 50), /too large/);
});

test("API fallback, source guard and config never expose credentials", async () => {
  const previous = process.env.FAL_KEY;
  delete process.env.FAL_KEY;
  try {
    const fallback = await direct(request("/api/director", { telemetry: snapshot(), history: [], start: true, mode: "llm" }));
    assert.equal(fallback.status, 200);
    const body = await fallback.json();
    assert.equal(body.translator, "deterministic");
    assert.match(body.warning, /FAL_KEY/);
    const preview = await direct(request("/api/director", { telemetry: snapshot({ source: "preview" }), start: true }));
    assert.equal(preview.status, 409);
    const missing = await proxy(request("/api/fal/proxy", {}));
    assert.equal(missing.status, 503);
    process.env.FAL_KEY = "test-private-value-never-return";
    const configResponse = await config(new Request("http://127.0.0.1:3000/api/config"));
    const configText = await configResponse.text();
    assert.equal(JSON.parse(configText).falConfigured, true);
    assert.ok(!configText.includes(process.env.FAL_KEY));
  } finally {
    if (previous === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previous;
  }
});

test("proxy rejects other endpoints and other models before any network request", async () => {
  const previous = process.env.FAL_KEY;
  process.env.FAL_KEY = "fake-test-key";
  try {
    const elsewhere = await proxy(request("/api/fal/proxy", {}, { "x-fal-target-url": "https://example.com/exfiltrate" }));
    assert.equal(elsewhere.status, 403);
    const otherModel = await proxy(request("/api/fal/proxy", { app_id: "different/model" }, { "x-fal-target-url": "https://wma.fal.run/ice" }));
    assert.equal(otherModel.status, 403);
    const injectedField = await proxy(request("/api/fal/proxy", { app_id: "minimax/h3-max/director", arbitrary: true }, { "x-fal-target-url": "https://wma.fal.run/ice" }));
    assert.equal(injectedField.status, 400);
  } finally {
    if (previous === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previous;
  }
});

test("proxy forwards only server credentials and the validated signalling body", async () => {
  const previousKey = process.env.FAL_KEY;
  const previousFetch = globalThis.fetch;
  process.env.FAL_KEY = "fake-server-key";
  let target = "";
  let authorization = "";
  globalThis.fetch = async (input, init) => {
    target = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    assert.equal(JSON.parse(String(init?.body)).app_id, "minimax/h3-max/director");
    assert.equal(init?.redirect, "error");
    return Response.json({ ice_servers: [] });
  };
  try {
    const result = await proxy(request("/api/fal/proxy", { app_id: "minimax/h3-max/director" }, { "x-fal-target-url": "https://wma.fal.run/ice", Authorization: "Key malicious-client-value" }));
    assert.equal(result.status, 200);
    assert.equal(target, "https://wma.fal.run/ice");
    assert.equal(authorization, "Key fake-server-key");
    assert.ok(!(await result.text()).includes("fake-server-key"));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previousKey;
  }
});

test("LLM direction preserves measured evidence and rejects an invented drive", async () => {
  const previousKey = process.env.FAL_KEY;
  const previousFetch = globalThis.fetch;
  process.env.FAL_KEY = "fake-server-key";
  let inventedDrive = false;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    assert.equal(String(input), "https://fal.run/openrouter/router");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "google/gemini-2.5-flash-lite");
    assert.equal(JSON.parse(body.prompt).drive, "rest");
    assert.match(body.system_prompt, /do not read a living fly/);
    return Response.json({ output: JSON.stringify({
      prompt: "Hold near a tiny amber droplet beneath a vast violet leaf. A pollen grain drifts gently through its curved reflection.",
      caption: "A small amber infinity.",
      drive: inventedDrive ? "escape" : "rest",
      reason: "Invented neurons proved that this fly has human dreams.",
    }) });
  };
  try {
    const result = await direct(request("/api/director", { telemetry: snapshot(), start: true, mode: "llm" }));
    const body = await result.json();
    assert.equal(body.translator, "llm");
    assert.equal(body.drive, "rest");
    assert.ok(!body.reason.includes("human dreams"));
    assert.match(body.prompt, /No speech/);
    inventedDrive = true;
    const invalid = await direct(request("/api/director", { telemetry: snapshot(), start: true, mode: "llm" }));
    const invalidBody = await invalid.json();
    assert.equal(invalidBody.translator, "deterministic");
    assert.equal(invalidBody.drive, "rest");
    assert.match(invalidBody.warning, /language model is unavailable/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previousKey;
  }
});

test("default direct mode does not call a provider even when a key is available", async () => {
  const previousKey = process.env.FAL_KEY;
  const previousFetch = globalThis.fetch;
  process.env.FAL_KEY = "fake-server-key";
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("No provider request is permitted in direct mode."); };
  try {
    const result = await direct(request("/api/director", { telemetry: snapshot(), start: true }));
    const body = await result.json();
    assert.equal(result.status, 200);
    assert.equal(body.translator, "deterministic");
    assert.equal(body.warning, undefined);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previousKey;
  }
});
