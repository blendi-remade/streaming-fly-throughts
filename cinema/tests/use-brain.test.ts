import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { EMPTY_BRAIN, type BrainSnapshot } from '../lib/types';
import type { StimulusObservation } from '../lib/use-brain';

// Deterministic network/timer harness: exercises the hook's external polling protocol without a browser or JVM.
const source = ts.transpileModule(readFileSync(new URL('../lib/use-brain.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sample = (sequence: number, kind = 'clear', trial = 0) => ({
  ...EMPTY_BRAIN, source: 'connectome', timestamp: Date.now(), sequence, trial, totalSpikes: sequence,
  stimulus: { kind, intensity: kind === 'clear' ? 0 : 0.85, remainingMs: 9000 },
});
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness() {
  const states: unknown[] = [];
  const cleanups: (() => void)[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const requests: { method: string; settled: boolean; reply: (body: unknown, status: number) => void }[] = [];
  let nextTimer = 0;
  let getFlights = 0;
  const module = { exports: {} as { useBrain: () => { stimulate: (kind: 'sugar') => Promise<StimulusObservation> } } };
  runInNewContext(source, {
    exports: module.exports,
    require: (name: string) => name === 'react' ? {
      useState: (initial: unknown) => {
        const index = states.length; states.push(initial);
        return [initial, (next: unknown) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
      },
      useRef: (current: unknown) => ({ current }),
      useEffect: (setup: () => () => void) => cleanups.push(setup()),
      useCallback: (callback: unknown) => callback,
    } : { EMPTY_BRAIN },
    AbortController, Date, console,
    setTimeout: (fn: () => void, ms: number) => { const key = ++nextTimer; timers.set(key, { fn, ms }); return key; },
    clearTimeout: (key: number) => timers.delete(key),
    fetch: (_url: string, options: RequestInit) => new Promise((resolve, reject) => {
      const method = options.method || 'GET';
      if (method === 'GET') { getFlights++; assert.equal(getFlights, 1, 'only one GET may be in flight'); }
      const entry = { method, settled: false, reply: (body: unknown, status: number) => {
        if (entry.settled) return;
        entry.settled = true;
        if (method === 'GET') getFlights--;
        resolve({ ok: status >= 200 && status < 300, json: async () => body });
      } };
      requests.push(entry);
      options.signal?.addEventListener('abort', () => {
        if (entry.settled) return;
        entry.settled = true;
        if (method === 'GET') getFlights--;
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }),
  });
  const brain = module.exports.useBrain();
  return {
    brain, states, requests, timers,
    reply(method: string, body: unknown, status = 200) {
      const request = requests.find(request => request.method === method && !request.settled);
      assert.ok(request, `Expected a pending ${method}`); request.reply(body, status);
    },
    fire(ms: number) {
      const timer = [...timers].find(([, timer]) => timer.ms === ms);
      assert.ok(timer, `Expected a ${ms} ms timer`); timers.delete(timer[0]); timer[1].fn();
    },
    cleanup() { cleanups.forEach(cleanup => cleanup()); },
  };
}

test('an acknowledged stimulus wakes polling without overlapping or accepting an older in-flight read', async () => {
  const h = harness();
  h.reply('GET', sample(1)); await flush();
  h.fire(150);
  let settled = false;
  const action = h.brain.stimulate('sugar').then(result => { settled = true; return result; });
  h.reply('POST', { accepted: true, kind: 'sugar', acceptedAt: Date.now() }); await flush();
  assert.equal(h.requests.filter(request => request.method === 'GET').length, 2);
  h.reply('GET', sample(3, 'sugar')); await flush();
  assert.equal(settled, false, 'a GET started before the acknowledgement cannot satisfy the action');
  h.fire(0); h.reply('GET', sample(4, 'sugar')); await flush();
  assert.equal((await action).snapshot.sequence, 4);
  assert.equal((h.states[0] as BrainSnapshot).sequence, 4);
  assert.ok([...h.timers.values()].some(timer => timer.ms === 150));
  h.cleanup();
});

test('repeating the same input waits for an advancing neural window and uses a temporary 50 ms cadence', async () => {
  const h = harness(); h.reply('GET', sample(10, 'sugar')); await flush();
  let settled = false;
  const action = h.brain.stimulate('sugar').then(result => { settled = true; return result; });
  h.reply('POST', { accepted: true, kind: 'sugar', acceptedAt: Date.now() }); await flush();
  h.reply('GET', sample(11, 'sugar')); await flush();
  assert.equal(settled, false);
  h.fire(50); h.reply('GET', sample(11, 'sugar')); await flush();
  assert.equal(settled, false, 'a repeated snapshot is not a new neural observation');
  h.fire(50); h.reply('GET', sample(12, 'sugar')); await flush();
  assert.equal((await action).snapshot.sequence, 12);
  h.cleanup();
});

test('a failed observation rejects the command, removes old activity, and resumes normal polling', async () => {
  const h = harness(); h.reply('GET', sample(1)); await flush();
  const rejected = assert.rejects(h.brain.stimulate('sugar'), /Brain bridge unavailable/);
  h.reply('POST', { accepted: true, kind: 'sugar' }); await flush();
  h.reply('GET', { error: 'Brain bridge unavailable' }, 503); await flush();
  await rejected;
  assert.equal(h.states[1], false);
  assert.equal(h.states[0], EMPTY_BRAIN);
  assert.ok((h.states[3] as number[]).every(value => value === 0));
  assert.ok([...h.timers.values()].some(timer => timer.ms === 150));
  h.cleanup();
});

test('new trials clear the trace and unmount aborts a pending action and observation', async () => {
  const h = harness(); h.reply('GET', sample(10)); await flush();
  h.fire(150); h.reply('GET', sample(11, 'clear', 1)); await flush();
  assert.ok((h.states[3] as number[]).slice(0, -1).every(value => value === 0));
  const rejected = assert.rejects(h.brain.stimulate('sugar'), /fresh brain activity/);
  h.reply('POST', { accepted: true, kind: 'sugar' }); await flush();
  h.cleanup(); await flush(); await rejected;
  assert.equal(h.timers.size, 0);
  assert.ok(h.requests.every(request => request.settled));
});
