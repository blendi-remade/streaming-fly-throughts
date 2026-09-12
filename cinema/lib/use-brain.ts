'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_BRAIN, type BrainSnapshot, type StimulusKind } from './types';
export type StimulusObservation = { accepted: true; snapshot: BrainSnapshot; kind?: string; action?: string };
type Observation = {
  kind: string;
  afterSequence: number;
  afterPoll: number;
  acceptedAt: number;
  needsBarrier: boolean;
  barrierSequence?: number;
  resolve: (snapshot: BrainSnapshot) => void;
  reject: (cause: Error) => void;
};
const POLL_MS = 150;
const OBSERVATION_POLL_MS = 50;
export function useBrain() {
  const [snapshot, setSnapshot] = useState<BrainSnapshot>(EMPTY_BRAIN);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<number[]>(Array(64).fill(0));
  const lastSequence = useRef(-1);
  const lastTrial = useRef<number | undefined>(undefined);
  const actions = useRef(new Set<AbortController>());
  const latest = useRef<BrainSnapshot>(EMPTY_BRAIN);
  const observations = useRef(new Set<Observation>());
  const pollSerial = useRef(0);
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    let polling = false;
    let refreshQueued = false;
    const waiting = observations.current;
    async function poll() {
      if (!alive || polling) return;
      polling = true;
      refreshQueued = false;
      clearTimeout(timer);
      const requestSerial = ++pollSerial.current;
      controller = new AbortController();
      const request = controller;
      const timeout = setTimeout(() => request.abort(), 4000);
      try {
        const response = await fetch('/api/brain', { signal: request.signal, cache: 'no-store' });
        const data = await response.json();
        if (!alive) return;
        if (!response.ok || data.source !== 'connectome' || !Array.isArray(data.populations)) throw new Error(data.error || 'Brain bridge unavailable.');
        if (!Number.isFinite(data.sequence) || !Number.isFinite(data.timestamp) || Date.now() - data.timestamp > 5000) throw new Error('Brain activity is stale. Check the bridge terminal.');
        latest.current = data;
        setSnapshot(data); setConnected(true); setError(null);
        const newTrial = (lastTrial.current !== undefined && data.trial !== lastTrial.current) || data.sequence < lastSequence.current;
        if (data.sequence !== lastSequence.current || newTrial) {
          setHistory(h => [...(newTrial ? Array(63).fill(0) : h.slice(-63)), data.totalSpikes]);
          lastSequence.current = data.sequence;
        }
        lastTrial.current = data.trial;
        for (const observation of waiting) {
          // An already-running read can contain pre-command state. Only a read started after acknowledgement
          // may satisfy the command promise. Normal and urgent reads always share this one poll flight.
          if (requestSerial <= observation.afterPoll) continue;
          if (observation.needsBarrier && observation.barrierSequence === undefined) {
            observation.barrierSequence = data.sequence;
            continue;
          }
          const after = Math.max(observation.afterSequence, observation.barrierSequence ?? -1);
          if (data.sequence > after && data.timestamp >= observation.acceptedAt && data.stimulus?.kind === observation.kind) {
            observation.resolve(data);
          }
        }
      } catch (cause) {
        if (!alive) return;
        setConnected(false); setSnapshot(EMPTY_BRAIN);
        latest.current = EMPTY_BRAIN;
        setHistory(h => h.some(value => value !== 0) ? Array(64).fill(0) : h);
        lastSequence.current = -1; lastTrial.current = undefined;
        const message = request.signal.aborted ? 'Brain request timed out. Check the bridge terminal.' : cause instanceof Error ? cause.message : 'Brain disconnected.';
        setError(message);
        for (const observation of waiting) observation.reject(new Error(message));
      } finally {
        clearTimeout(timeout);
        polling = false;
        if (alive) timer = setTimeout(poll, refreshQueued ? 0 : waiting.size ? OBSERVATION_POLL_MS : POLL_MS);
      }
    }
    refresh.current = () => {
      if (!alive) return;
      refreshQueued = true;
      clearTimeout(timer);
      if (!polling) void poll();
    };
    void poll();
    const pendingActions = actions.current;
    return () => {
      alive = false; refresh.current = null; clearTimeout(timer); controller?.abort();
      pendingActions.forEach(action => action.abort()); pendingActions.clear();
      for (const observation of waiting) observation.reject(new Error('Brain observation cancelled.'));
    };
  }, []);
  const stimulate = useCallback(async (kind: StimulusKind, durationMs = 10000): Promise<StimulusObservation> => {
    if (!refresh.current) throw new Error('Brain connection is not ready.');
    const controller = new AbortController();
    actions.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('/api/brain', { signal: controller.signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, intensity: 0.85, durationMs }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.accepted !== true) throw new Error(body.error || 'Could not apply stimulus.');
      const requestKind: string = kind;
      const expectedKind = requestKind === 'reset' ? 'clear' : requestKind;
      const observed = await new Promise<BrainSnapshot>((resolve, reject) => {
        let observation: Observation;
        const finish = (snapshot?: BrainSnapshot, cause?: Error) => {
          observations.current.delete(observation);
          controller.signal.removeEventListener('abort', abort);
          if (snapshot) resolve(snapshot); else reject(cause);
        };
        const abort = () => finish(undefined, new Error('Stimulus was accepted, but fresh brain activity did not arrive in time.'));
        observation = {
          kind: expectedKind,
          afterSequence: lastSequence.current,
          afterPoll: pollSerial.current,
          acceptedAt: Number.isFinite(body.acceptedAt) ? body.acceptedAt : Date.now(),
          // Identical repeated inputs cannot be distinguished by kind alone. Observe another completed window
          // after the first post-ack read, rather than treating the old active input as newly applied.
          needsBarrier: latest.current.stimulus.kind === expectedKind,
          resolve: snapshot => finish(snapshot),
          reject: cause => finish(undefined, cause),
        };
        if (controller.signal.aborted) { abort(); return; }
        observations.current.add(observation);
        controller.signal.addEventListener('abort', abort, { once: true });
        refresh.current?.();
      });
      return { accepted: true, snapshot: observed, kind: body.kind, action: body.action };
    } finally { clearTimeout(timeout); actions.current.delete(controller); }
  }, []);
  return { snapshot, connected, error, history, stimulate };
}
