import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_BRAIN, type BrainSnapshot } from '../lib/types';
import { EMPTY_SCENE_SELECTION, SCENE_MAX_SAMPLE_AGE_MS, selectSceneEvidence } from '../lib/scene-selection';

const sample = (time: number, sequence: number, motors: Partial<BrainSnapshot['motors']> = {}, extra = {}): BrainSnapshot => ({
  ...EMPTY_BRAIN, source: 'connectome', timestamp: time, sequence, simulatedMs: sequence * 50,
  motors: { ...EMPTY_BRAIN.motors, ...motors }, ...extra,
});

test('a real escape event remains legible between quiet windows without changing the sample', () => {
  const escape = sample(10_000, 1, { escape: 1 });
  const quiet = sample(10_350, 2);
  const initial = selectSceneEvidence(EMPTY_SCENE_SELECTION, escape, true, 10_000);
  const held = selectSceneEvidence(initial, quiet, true, 10_350);
  assert.equal(held.snapshot, escape);
  assert.equal(held.snapshot?.timestamp, 10_000);
  assert.equal(quiet.motors.escape, 0);
  assert.equal(held.holdUntilMs, 13_000);
  assert.equal(selectSceneEvidence(held, quiet, true, 13_000).snapshot, quiet);
});

test('stronger new evidence preempts and weaker different evidence has a bounded wait', () => {
  const feed = sample(10_000, 1, { feed: .4 });
  const groom = sample(10_350, 2, { groom: .3 });
  const escape = sample(10_700, 3, { escape: 1 });
  const fed = selectSceneEvidence(EMPTY_SCENE_SELECTION, feed, true, 10_000);
  const held = selectSceneEvidence(fed, groom, true, 10_350);
  assert.equal(held.snapshot, feed);
  assert.equal(selectSceneEvidence(held, escape, true, 10_700).snapshot, escape);
  assert.equal(selectSceneEvidence(held, groom, true, 13_000).snapshot, groom);
});

test('new matching evidence refreshes the sample; duplicate polling does not extend it', () => {
  const first = sample(10_000, 1, { escape: 1 });
  const second = sample(10_700, 2, { escape: 1 });
  let state = selectSceneEvidence(EMPTY_SCENE_SELECTION, first, true, 10_000);
  state = selectSceneEvidence(state, { ...first }, true, 10_650);
  assert.equal(state.holdUntilMs, 13_000);
  state = selectSceneEvidence(state, second, true, 10_700);
  assert.equal(state.snapshot, second);
  assert.equal(state.holdUntilMs, 13_700);
});

test('equal-strength escape preempts a saturated scene, matching interpreter tie priority', () => {
  const smell = sample(10_000, 1, {}, { populations: [{ name: 'ORN_DM1', hz: 150, count: 74 }] });
  const escape = sample(10_350, 2, { escape: 1 });
  const state = selectSceneEvidence(EMPTY_SCENE_SELECTION, smell, true, 10_000);
  assert.equal(selectSceneEvidence(state, escape, true, 10_350).snapshot, escape);
});

test('offline, synthetic, invalid, and stale data cannot retain a scene', () => {
  const first = sample(10_000, 1, { escape: 1 });
  const state = selectSceneEvidence(EMPTY_SCENE_SELECTION, first, true, 10_000);
  assert.equal(selectSceneEvidence(state, first, false, 10_001).snapshot, null);
  assert.equal(selectSceneEvidence(state, { ...first, source: 'preview' }, true, 10_001).snapshot, null);
  assert.equal(selectSceneEvidence(state, { ...first, timestamp: NaN }, true, 10_001).snapshot, null);
  assert.equal(selectSceneEvidence(state, first, true, 10_000 + SCENE_MAX_SAMPLE_AGE_MS).snapshot, null);
});

test('new trial metadata and legacy sequence rollback immediately discard previous evidence', () => {
  const old = sample(10_000, 100, { escape: 1 }, { trial: 3, resetAt: 9_000 });
  const state = selectSceneEvidence(EMPTY_SCENE_SELECTION, old, true, 10_000);
  const reset = sample(10_200, 101, {}, { trial: 4, resetAt: 10_100 });
  assert.equal(selectSceneEvidence(state, reset, true, 10_200).snapshot, reset);
  const legacyOld = sample(10_000, 100, { escape: 1 });
  const legacyState = selectSceneEvidence(EMPTY_SCENE_SELECTION, legacyOld, true, 10_000);
  const legacyReset = sample(10_200, 1);
  assert.equal(selectSceneEvidence(legacyState, legacyReset, true, 10_200).snapshot, legacyReset);
});

test('neither stimulus labels nor quiet telemetry create a held active response', () => {
  const labelOnly = sample(10_000, 1, {}, { stimulus: { kind: 'loom', intensity: 1, remainingMs: 10_000 } });
  const state = selectSceneEvidence(EMPTY_SCENE_SELECTION, labelOnly, true, 10_000);
  assert.equal(state.holdUntilMs, 10_000);
  const quiet = sample(10_350, 2);
  assert.equal(selectSceneEvidence(state, quiet, true, 10_350).snapshot, quiet);
});

test('measured sensory themes can persist without inventing a motor drive', () => {
  const smell = sample(10_000, 1, {}, { populations: [{ name: 'ORN_DM1', hz: 40, count: 74 }] });
  const quiet = sample(10_350, 2);
  const state = selectSceneEvidence(EMPTY_SCENE_SELECTION, smell, true, 10_000);
  const held = selectSceneEvidence(state, quiet, true, 10_350);
  assert.equal(held.snapshot, smell);
  assert.equal(held.snapshot?.motors.forward, 0);
});

test('a delayed observation never escapes the original eight-second age limit', () => {
  const delayed = sample(10_000, 1, { escape: 1 });
  const state = selectSceneEvidence(EMPTY_SCENE_SELECTION, delayed, true, 16_000);
  assert.equal(state.holdUntilMs, 18_000);
  assert.equal(state.snapshot?.timestamp, 10_000);
  assert.equal(selectSceneEvidence(state, delayed, true, 18_000).snapshot, null);
});
