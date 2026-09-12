import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import * as cinematic from "../lib/cinematic";
import * as scheduling from "../lib/director-scheduling";
import { EMPTY_BRAIN, type BrainSnapshot } from "../lib/types";
import type { useDirector } from "../lib/use-director";

type Hook = ReturnType<typeof useDirector>;
type OpenOptions = { onData: (raw: string) => void; onMedia: (stream: MediaStream) => void; onState: (state: string) => void };

/** Execute the real hook with deterministic time and mocked React/transport boundaries. */
function harness(deferConfig = false) {
  let now = 1_000_000;
  let state: Hook;
  let options: OpenOptions | null = null;
  let opened = 0;
  let closes = 0;
  let nextTimer = 0;
  let releaseConfig: (() => void) | null = null;
  const timers = new Map<number, { at: number; callback: () => void; repeat?: number }>();
  const sent: Record<string, unknown>[] = [];
  const requests: { url: string; aborted: boolean }[] = [];
  const cleanups: (() => void)[] = [];
  const session = { send: (message: Record<string, unknown>) => sent.push(message), close: () => { closes += 1; } };
  const setTimer = (callback: () => void, delay = 0, repeat?: number) => {
    const id = ++nextTimer;
    timers.set(id, { at: now + delay, callback, repeat }); return id;
  };
  class ClockDate extends Date { static now() { return now; } }
  const context = createContext({
    exports: {}, Date: ClockDate, AbortController, AbortSignal,
    setTimeout: (callback: () => void, delay: number) => setTimer(callback, delay),
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: (callback: () => void, delay: number) => setTimer(callback, delay, delay),
    clearInterval: (id: number) => timers.delete(id),
    window: { addEventListener() {}, removeEventListener() {} },
    fetch: async (url: string, init: RequestInit = {}) => {
      const record = { url, aborted: false }; requests.push(record);
      if (url === "/api/config") {
        if (deferConfig) await new Promise<void>(resolve => { releaseConfig = resolve; });
        return Response.json({ falConfigured: true });
      }
      assert.equal(url, "/api/director");
      assert.equal(JSON.parse(String(init.body)).mode, "llm");
      // Leave optional enrichment in flight to prove a changed state cancels it.
      return new Promise<Response>((resolve, reject) => {
        void resolve;
        init.signal?.addEventListener("abort", () => { record.aborted = true; reject(new Error("aborted")); }, { once: true });
      });
    },
    require: (specifier: string) => {
      if (specifier === "react") return {
        useRef: (value: unknown) => ({ current: value }),
        useState: (value: Hook) => { state = value; return [value, (next: Hook) => { state = next; }]; },
        useCallback: (fn: unknown) => fn,
        useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
      };
      if (specifier === "@fal-ai/client") return { createFalClient: () => ({ realtime: { open: (_endpoint: unknown, callbacks: OpenOptions) => { opened += 1; options = callbacks; return session; } } }) };
      if (specifier === "@fal-ai/client/realtime") return { wma: (endpoint: string) => endpoint };
      if (specifier === "./cinematic") return cinematic;
      if (specifier === "./director-scheduling") return scheduling;
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  });
  const source = readFileSync(new URL("../lib/use-director.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInContext(compiled, context);
  const hook = (context.exports as { useDirector: () => Hook }).useDirector();
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const sample = (motors: Partial<BrainSnapshot["motors"]> = {}): BrainSnapshot => ({ ...EMPTY_BRAIN, source: "connectome", timestamp: now, motors: { ...EMPTY_BRAIN.motors, ...motors } });
  return {
    hook, sent, requests, sample,
    get state() { return state; }, get opened() { return opened; }, get closes() { return closes; },
    releaseConfig: () => releaseConfig?.(),
    event: (message: object) => { assert.ok(options); options.onData(JSON.stringify(message)); },
    async advance(milliseconds: number) {
      const target = now + milliseconds;
      for (let i = 0; i < 2_000; i++) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) { now = target; await flush(); return; }
        now = next[1].at;
        if (next[1].repeat) timers.set(next[0], { ...next[1], at: now + next[1].repeat }); else timers.delete(next[0]);
        next[1].callback(); await flush();
      }
      throw new Error("Timer loop did not settle");
    },
    cleanup: async () => { cleanups.forEach(fn => fn()); await flush(); },
  };
}

test("opening has no LLM dependency, even when optional enrichment is enabled", async () => {
  const h = harness();
  h.hook.setTranslatorMode("llm");
  await h.hook.start(h.sample());
  assert.equal(h.opened, 1);
  assert.deepEqual(h.requests.map(r => r.url), ["/api/config"]);
  assert.equal(h.sent[0].type, "configure");
  assert.equal(h.state.pendingVersion, 1);
  await h.cleanup();
});

test("actual hook sends a changed drive immediately and coalesces provider-pending observations", async () => {
  const h = harness();
  await h.hook.start(h.sample());
  h.event({ type: "configured", prompt_version: 1 });
  await h.advance(1_000);
  await h.hook.steer(h.sample({ escape: 1 }));
  await h.advance(0);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].replan, true);
  assert.equal(h.state.latency.observedToSentMs, 0);
  await h.hook.steer(h.sample({ groom: 1 }));
  await h.hook.steer(h.sample({ feed: 1 }));
  await h.advance(1_000);
  assert.equal(h.sent.length, 2, "no extra prompt is sent before admission");
  h.event({ type: "prompt_applied", prompt_version: 2 });
  await h.advance(0);
  assert.equal(h.sent.length, 3);
  assert.match(String(h.sent[2].prompt), /nectar|fruit|sugar/);
  assert.ok(h.requests.every(r => r.url === "/api/config"));
  await h.cleanup();
});

test("new measured state aborts optional LLM work and takes the direct path", async () => {
  const h = harness();
  h.hook.setTranslatorMode("llm");
  await h.hook.start(h.sample());
  h.event({ type: "configured", prompt_version: 1 });
  await h.advance(6_000); await h.hook.steer(h.sample());
  await h.advance(5_900); await h.hook.steer(h.sample());
  await h.advance(100);
  assert.equal(h.requests.filter(r => r.url === "/api/director").length, 1);
  await h.hook.steer(h.sample({ escape: 1 }));
  await h.advance(0); await h.advance(0);
  assert.equal(h.requests.find(r => r.url === "/api/director")?.aborted, true);
  assert.equal(h.sent.length, 2);
  assert.match(String(h.sent[1].prompt), /shadow|darkness|canopy/);
  await h.cleanup();
});

test("cancelling startup prevents a late config response from opening a session", async () => {
  const h = harness(true);
  const starting = h.hook.start(h.sample());
  await h.hook.stop();
  h.releaseConfig(); await starting;
  assert.equal(h.opened, 0);
  assert.equal(h.state.status, "idle");
  await h.cleanup();
});

test("a disconnected brain cancels a connecting session and sends stop", async () => {
  const h = harness();
  await h.hook.start(h.sample());
  await h.hook.steer(EMPTY_BRAIN);
  assert.equal(h.sent.at(-1)?.type, "stop");
  assert.equal(h.closes, 1);
  assert.equal(h.state.status, "error");
  await h.cleanup();
});
