'use client';

import { useEffect, useState } from 'react';
import type { BrainSnapshot } from './types';
import { EMPTY_SCENE_SELECTION, sameSceneSample, selectSceneEvidence } from './scene-selection';

/**
 * Use this sample for scene direction only. Keep the raw snapshot for graphs,
 * live rates, connectivity, and neural-activity animation. Display evidence age
 * whenever `held` is true; the preserved timestamp also reaches Director's
 * existing eight-second freshness guard unchanged.
 */
export function useSceneEvidence(snapshot: BrainSnapshot, connected: boolean, revision = 0) {
  const [memory, setMemory] = useState({ revision, selection: EMPTY_SCENE_SELECTION });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  // Project synchronously so an offline signal or a newly observed reset never
  // renders the preceding trial's scene while waiting for a React effect.
  const selected = selectSceneEvidence(memory.revision === revision ? memory.selection : EMPTY_SCENE_SELECTION, snapshot, connected, now);
  useEffect(() => {
    setMemory(previous => {
      const selection = selectSceneEvidence(previous.revision === revision ? previous.selection : EMPTY_SCENE_SELECTION, snapshot, connected, now);
      return selection === previous.selection && revision === previous.revision ? previous : { selection, revision };
    });
  }, [snapshot, connected, now, revision]);

  return {
    snapshot: selected.snapshot,
    held: selected.snapshot !== null && !sameSceneSample(selected.snapshot, snapshot),
    evidenceAgeMs: selected.snapshot ? Math.max(0, now - selected.snapshot.timestamp) : 0,
    holdRemainingMs: Math.max(0, selected.holdUntilMs - now),
  };
}
