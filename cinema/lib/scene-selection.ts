import { interpretBrain } from './cinematic';
import { readBrain } from './readings';
import type { BrainSnapshot } from './types';

/** An editorial dwell time, in wall time. It does not prolong a neural response. */
export const SCENE_HOLD_MS = 3_000;
export const SCENE_MAX_SAMPLE_AGE_MS = 8_000;

export interface SceneSelection {
  /** The exact received sample, never a synthetic blend or a re-timestamped copy. */
  snapshot: BrainSnapshot | null;
  holdUntilMs: number;
  lastInput: BrainSnapshot | null;
}

export const EMPTY_SCENE_SELECTION: SceneSelection = {
  snapshot: null, holdUntilMs: 0, lastInput: null,
};

type TrialSnapshot = BrainSnapshot & { trial?: number; resetAt?: number };

export function isFreshSceneSample(snapshot: BrainSnapshot, now: number): boolean {
  return snapshot.source === 'connectome'
    && Number.isFinite(snapshot.timestamp)
    && Number.isFinite(now)
    && Math.abs(now - snapshot.timestamp) < SCENE_MAX_SAMPLE_AGE_MS;
}

function sameTrial(a: BrainSnapshot, b: BrainSnapshot): boolean {
  return (a as TrialSnapshot).trial === (b as TrialSnapshot).trial
    && (a as TrialSnapshot).resetAt === (b as TrialSnapshot).resetAt;
}

export function sameSceneSample(a: BrainSnapshot, b: BrainSnapshot): boolean {
  return a.source === b.source && a.sequence === b.sequence
    && a.timestamp === b.timestamp && sameTrial(a, b);
}

function sceneMeasurement(snapshot: BrainSnapshot) {
  const direction = interpretBrain(snapshot);
  return {
    identity: `${direction.drive}:${direction.sensoryTheme ?? ''}`,
    active: direction.drive !== 'rest' || Boolean(direction.sensoryTheme),
    strength: readBrain(snapshot).strength,
    // Match interpretBrain's tie order. In particular, a saturated sensory
    // metaphor must not repeatedly hide an equally strong real escape event.
    priority: ['rest', 'explore', 'flight', 'groom', 'feed', 'escape'].indexOf(direction.drive),
  };
}

/**
 * Select a recently observed scene without changing any measurements.
 * Matching active evidence renews the dwell only on a new neural sample.
 * Stronger different evidence preempts; quiet/weaker evidence waits at most
 * three wall seconds since the last matching observation. Trial changes,
 * disconnection, and the original sample's freshness limit override the dwell.
 */
export function selectSceneEvidence(
  previous: SceneSelection,
  input: BrainSnapshot,
  connected: boolean,
  now: number,
): SceneSelection {
  if (!connected || !isFreshSceneSample(input, now)) return EMPTY_SCENE_SELECTION;

  const incoming = sceneMeasurement(input);
  const selectInput = (): SceneSelection => ({
    snapshot: input,
    // A delayed sample must not be extended beyond its original freshness limit.
    holdUntilMs: incoming.active ? Math.min(now + SCENE_HOLD_MS, input.timestamp + SCENE_MAX_SAMPLE_AGE_MS) : now,
    lastInput: input,
  });
  const previousInput = previous.lastInput;
  const reset = previousInput !== null && (
    !sameTrial(previousInput, input)
    || input.sequence < previousInput.sequence
    || input.simulatedMs < previousInput.simulatedMs
  );
  if (!previous.snapshot || reset || !isFreshSceneSample(previous.snapshot, now)) return selectInput();

  const chosen = sceneMeasurement(previous.snapshot);
  const newSample = !previousInput || !sameSceneSample(previousInput, input);
  const sameScene = incoming.identity === chosen.identity;
  if (sameScene && newSample) return selectInput();
  if (sameScene) return previous;
  const stronger = incoming.strength > chosen.strength
    || (incoming.strength === chosen.strength && incoming.priority > chosen.priority);
  if (now >= previous.holdUntilMs || stronger) return selectInput();
  return previousInput === input ? previous : { ...previous, lastInput: input };
}
