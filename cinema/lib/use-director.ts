"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";
import type { BrainSnapshot } from "./types";
import { interpretBrain, type CinematicDirection } from "./cinematic";
import { DirectorScheduler, directionKey, EMPTY_LATENCY, type DirectorLatency, type TranslatorMode } from "./director-scheduling";
export type { DirectorLatency, TranslatorMode } from "./director-scheduling";

export const DIRECTOR_SESSION_SECONDS = 180;
export const DIRECTOR_ENDPOINT = "minimax/h3-max/director";
const MAX_SAMPLE_AGE_MS = 8_000;
type Status = "idle" | "connecting" | "live" | "stopping" | "error";
type Session = { send: (message: object) => void; close: () => Promise<void> | void };
interface DirectorState {
  status: Status;
  stream: MediaStream | null;
  caption: string;
  prompt: string;
  error: string | null;
  bufferSeconds: number;
  appliedVersion: number;
  /** Latest generated chunk's version, not the browser's current displayed frame. */
  visibleVersion: number;
  pendingVersion: number;
  elapsed: number;
  translatorMode: TranslatorMode;
  latency: DirectorLatency;
}
const initialState: DirectorState = {
  status: "idle", stream: null, caption: "", prompt: "", error: null,
  bufferSeconds: 0, appliedVersion: 0, visibleVersion: 0, pendingVersion: 0, elapsed: 0,
  translatorMode: "direct", latency: { ...EMPTY_LATENCY },
};

function healthySample(snapshot: BrainSnapshot): boolean {
  return snapshot.source === "connectome" && Number.isFinite(snapshot.timestamp) && Math.abs(Date.now() - snapshot.timestamp) < MAX_SAMPLE_AGE_MS;
}

export function useDirector(): DirectorState & {
  start: (telemetry: BrainSnapshot) => Promise<void>;
  steer: (telemetry: BrainSnapshot) => Promise<void>;
  stop: () => Promise<void>;
  setTranslatorMode: (mode: TranslatorMode) => void;
} {
  const [state, setState] = useState<DirectorState>(initialState);
  const mounted = useRef(true);
  const current = useRef(state);
  const session = useRef<Session | null>(null);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const translation = useRef<AbortController | null>(null);
  const latest = useRef<BrainSnapshot | null>(null);
  const receivedAt = useRef(0);
  const history = useRef<string[]>([]);
  const version = useRef(0);
  const variant = useRef(0);
  const busy = useRef(false);
  const scheduler = useRef(new DirectorScheduler());
  const openingAt = useRef(0);
  const liveAt = useRef(0);
  const serverLimit = useRef(DIRECTOR_SESSION_SECONDS);
  const scheduled = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clock = useRef<ReturnType<typeof setInterval> | null>(null);
  const generatedSeconds = useRef(0);
  const lastChunk = useRef(-1);
  const stopping = useRef<Promise<void> | null>(null);

  const patch = useCallback((changes: Partial<DirectorState>) => {
    if (!mounted.current) return;
    current.current = { ...current.current, ...changes };
    setState(current.current);
  }, []);
  const progress = useCallback(() => {
    patch({ pendingVersion: scheduler.current.pendingVersion, latency: scheduler.current.latency });
  }, [patch]);
  const clearTimers = useCallback(() => {
    if (scheduled.current) clearTimeout(scheduled.current);
    if (clock.current) clearInterval(clock.current);
    scheduled.current = null; clock.current = null;
  }, []);

  const finish = useCallback(async (message: string | null = null, failure = false) => {
    if (stopping.current) return stopping.current;
    if (!session.current && !controller.current && current.current.status === "idle" && !message) return;
    epoch.current += 1;
    clearTimers();
    const closingSession = session.current;
    // Stop while SCTP is available, before abort tears down the transport.
    try { closingSession?.send({ type: "stop" }); } catch { /* already closed */ }
    translation.current?.abort(); translation.current = null;
    controller.current?.abort(); controller.current = null;
    latest.current = null; busy.current = false;
    const closingStream = current.current.stream;
    session.current = null;
    patch({ status: "stopping", error: message, stream: null, pendingVersion: 0 });
    const close = async () => {
      try { await closingSession?.close(); } catch { /* transport already closed */ }
      closingStream?.getTracks().forEach(track => track.stop());
      patch({ status: failure ? "error" : "idle", bufferSeconds: 0 });
    };
    const promise = close(); stopping.current = promise;
    try { await promise; } finally { stopping.current = null; }
  }, [clearTimers, patch]);
  const stop = useCallback(async () => { await finish(); }, [finish]);

  const translate = useCallback(async (snapshot: BrainSnapshot, signal: AbortSignal): Promise<CinematicDirection> => {
    const response = await fetch("/api/director", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ telemetry: snapshot, history: history.current.slice(-6), start: false, mode: "llm" }),
    });
    const result = await response.json() as CinematicDirection & { error?: string };
    if (!response.ok) throw new Error(result.error || `Translation failed (HTTP ${response.status}).`);
    if (typeof result.prompt !== "string" || typeof result.caption !== "string" || result.source !== "connectome") throw new Error("Invalid translation response.");
    return result;
  }, []);

  const performSteer = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback(() => {
    if (scheduled.current) clearTimeout(scheduled.current);
    scheduled.current = null;
    if (busy.current || !["live", "connecting"].includes(current.current.status) || !session.current) return;
    const due = scheduler.current.next(Date.now());
    if (!due) return; // Admission events wake the latest coalesced observation.
    scheduled.current = setTimeout(() => { scheduled.current = null; void performSteer.current(); }, due.waitMs);
  }, []);

  const sendDirection = useCallback((direction: CinematicDirection) => {
    if (!session.current) return;
    version.current += 1;
    scheduler.current.sent(version.current, directionKey(direction), Date.now());
    session.current.send({ type: "prompt", prompt_version: version.current, prompt: direction.prompt, replan: true });
    variant.current += 1;
    history.current = [...history.current, direction.prompt.slice(0, 1_200)].slice(-6);
    patch({ caption: direction.caption, prompt: direction.prompt, error: direction.warning ?? null });
    progress();
  }, [patch, progress]);

  performSteer.current = async () => {
    if (busy.current || !["live", "connecting"].includes(current.current.status) || !session.current || !latest.current) return;
    const snapshot = latest.current;
    if (!healthySample(snapshot) || Date.now() - receivedAt.current > MAX_SAMPLE_AGE_MS) {
      await finish("The brain signal stopped. Cinema paused to keep imagery tied to measured activity.", true); return;
    }
    const due = scheduler.current.next(Date.now());
    if (!due) return;
    if (due.waitMs > 0) { schedule(); return; }
    const thisEpoch = epoch.current;
    const signal = controller.current?.signal;
    if (!signal) return;
    // Opening and observed state changes ALWAYS use the immediate authored path.
    // LLM mode enriches only a steady continuation, and is cancelled on new evidence.
    const useLlm = current.current.translatorMode === "llm" && due.kind === "continuation";
    busy.current = true;
    const request = new AbortController();
    translation.current = request;
    try {
      let direction = interpretBrain(snapshot, false, variant.current);
      if (useLlm) {
        try {
          const enriched = await translate(snapshot, AbortSignal.any([signal, request.signal]));
          if (thisEpoch !== epoch.current || request.signal.aborted || signal.aborted) return;
          if (!latest.current || !healthySample(latest.current)) return;
          const fresh = interpretBrain(latest.current, false, variant.current);
          if (directionKey(fresh) !== directionKey(enriched)) return;
          // Keep provenance current; the model supplies only the artistic prose.
          direction = { ...fresh, prompt: enriched.prompt, caption: enriched.caption, translator: enriched.translator, warning: enriched.warning };
        } catch (error) {
          if (thisEpoch !== epoch.current || signal.aborted || request.signal.aborted) return;
          direction = { ...interpretBrain(latest.current ?? snapshot, false, variant.current), warning: error instanceof Error ? `${error.message} Using direct artistic translation.` : "Using direct artistic translation." };
        }
      }
      if (thisEpoch !== epoch.current || signal.aborted || request.signal.aborted) return;
      if (directionKey(direction) !== scheduler.current.latestKey) return;
      sendDirection(direction);
    } catch (error) {
      if (thisEpoch === epoch.current && !signal.aborted) await finish(error instanceof Error ? error.message : "The next direction could not be sent.", true);
    } finally {
      if (translation.current === request) translation.current = null;
      if (thisEpoch === epoch.current) { busy.current = false; schedule(); }
    }
  };

  const setTranslatorMode = useCallback((mode: TranslatorMode) => {
    if (mode !== "direct" && mode !== "llm") return;
    patch({ translatorMode: mode });
    if (mode === "direct") translation.current?.abort();
    schedule();
  }, [patch, schedule]);

  const steer = useCallback(async (telemetry: BrainSnapshot) => {
    latest.current = telemetry; receivedAt.current = Date.now();
    if (!["live", "connecting"].includes(current.current.status)) return;
    if (!healthySample(telemetry)) {
      await finish("The connectome disconnected or became stale. Live cinema stopped; local rehearsal remains available.", true); return;
    }
    const key = directionKey(interpretBrain(telemetry));
    const changed = key !== scheduler.current.latestKey;
    scheduler.current.observe(key, Date.now());
    if (changed) translation.current?.abort();
    schedule();
  }, [finish, schedule]);

  const start = useCallback(async (telemetry: BrainSnapshot) => {
    if (["connecting", "live", "stopping"].includes(current.current.status)) return;
    if (!healthySample(telemetry)) { patch({ status: "error", error: "Start the brain simulation and wait for a fresh connectome signal before opening live cinema." }); return; }
    const thisEpoch = ++epoch.current;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    latest.current = telemetry; receivedAt.current = Date.now(); history.current = [];
    version.current = 1; variant.current = 0; generatedSeconds.current = 0; lastChunk.current = -1;
    liveAt.current = 0; openingAt.current = Date.now(); serverLimit.current = DIRECTOR_SESSION_SECONDS;
    scheduler.current = new DirectorScheduler();
    scheduler.current.observe(directionKey(interpretBrain(telemetry)), Date.now());
    patch({ ...initialState, translatorMode: current.current.translatorMode, status: "connecting" });
    try {
      const configResponse = await fetch("/api/config", { signal, cache: "no-store" });
      const config = await configResponse.json() as { falConfigured?: boolean };
      if (!configResponse.ok || !config.falConfigured) throw new Error("Add FAL_KEY to cinema/.env.local and restart the app to enable live cinema.");
      if (thisEpoch !== epoch.current || signal.aborted) return;
      const fresh = latest.current ?? telemetry;
      if (!healthySample(fresh)) throw new Error("The brain signal became stale before the cinema opened.");
      const direction = interpretBrain(fresh, true);
      scheduler.current.observe(directionKey(direction), Date.now());
      // No LLM call is on the startup critical path, regardless of enrichment mode.
      const client = createFalClient({ proxyUrl: "/api/fal/proxy" });
      const active = () => thisEpoch === epoch.current && !signal.aborted;
      const opened = client.realtime.open(wma(DIRECTOR_ENDPOINT), {
        receive: ["video", "audio"], abortSignal: signal, negotiationTimeoutMs: 100_000,
        onMedia: stream => {
          if (!active()) { stream.getTracks().forEach(track => track.stop()); return; }
          if (!liveAt.current) liveAt.current = Date.now();
          patch({ status: "live", stream }); schedule();
        },
        onData: raw => {
          if (!active()) return;
          let message: Record<string, unknown>;
          try { message = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
          if (!message || typeof message !== "object") return;
          const promptVersion = typeof message.prompt_version === "number" && Number.isFinite(message.prompt_version) ? Math.max(0, Math.floor(message.prompt_version)) : 0;
          switch (message.type) {
            case "session_info":
              if (typeof message.max_session_seconds === "number" && message.max_session_seconds > 0) serverLimit.current = Math.min(DIRECTOR_SESSION_SECONDS, message.max_session_seconds);
              break;
            case "configured":
            case "prompt_applied":
              scheduler.current.accepted(promptVersion, Date.now());
              patch({ appliedVersion: Math.max(current.current.appliedVersion, promptVersion) });
              progress(); schedule(); break;
            case "prompt_pending": scheduler.current.pending(promptVersion); progress(); break;
            case "prompt_rejected": {
              scheduler.current.rejected(promptVersion);
              version.current = Math.max(version.current, promptVersion);
              const reason = typeof message.reason === "string" ? message.reason.replaceAll("_", " ") : "preparation failed";
              patch({ error: `The next direction was rejected: ${reason}. The current scene continues.` });
              progress(); schedule(); break;
            }
            case "chunk": {
              const index = typeof message.chunk_index === "number" && Number.isFinite(message.chunk_index) ? message.chunk_index : -1;
              if (index <= lastChunk.current) break;
              lastChunk.current = index;
              if (typeof message.playback_seconds === "number" && Number.isFinite(message.playback_seconds) && message.playback_seconds > 0) generatedSeconds.current += message.playback_seconds;
              scheduler.current.generated(promptVersion, Date.now());
              patch({ visibleVersion: promptVersion, bufferSeconds: typeof message.buffer_depth_seconds === "number" && Number.isFinite(message.buffer_depth_seconds) ? Math.max(0, message.buffer_depth_seconds) : current.current.bufferSeconds });
              progress(); schedule();
              if (generatedSeconds.current >= serverLimit.current) void finish("The three-minute screening has ended.");
              break;
            }
            case "deadline_missed": patch({ bufferSeconds: 0, error: "Director is buffering. Video may hold while the next scene is generated." }); break;
            case "stream_exhausted": void finish("Director has finished this screening."); break;
            case "error": {
              const code = typeof message.code === "string" ? message.code : "unknown";
              const explanation = typeof message.error === "string" ? message.error.slice(0, 250) : "Director could not continue.";
              if (["stale_prompt_version", "invalid_message"].includes(code)) {
                scheduler.current.rejected(promptVersion || scheduler.current.pendingVersion);
                version.current = Math.max(version.current + 1, promptVersion + 1);
                patch({ error: explanation }); progress(); schedule();
              } else void finish(explanation, true);
              break;
            }
          }
        },
        onState: next => {
          if (!active()) return;
          if (next === "failed") void finish("The Director connection failed. Check your key and network, then retry.", true);
          if (next === "closed") void finish(current.current.status === "connecting" ? "Director closed before video arrived." : "The Director connection closed.", current.current.status === "connecting");
        },
        onError: () => { if (active()) void finish("Director could not establish or maintain the video stream. Check your key, balance and connection.", true); },
      });
      session.current = opened;
      scheduler.current.sent(1, directionKey(direction), Date.now());
      opened.send({ type: "configure", protocol_version: 1, prompt_version: 1, prompt: direction.prompt, resolution: "480p", aspect_ratio: "16:9", memory: 12 });
      history.current = [direction.prompt.slice(0, 1_200)];
      patch({ caption: direction.caption, prompt: direction.prompt, error: null }); progress();
      clock.current = setInterval(() => {
        if (!active()) return;
        if (Date.now() - receivedAt.current > MAX_SAMPLE_AGE_MS) { void finish("The brain signal stopped. Live cinema has ended.", true); return; }
        if (liveAt.current) {
          const elapsed = (Date.now() - liveAt.current) / 1_000; patch({ elapsed });
          if (elapsed >= serverLimit.current) void finish("The three-minute screening has ended.");
        } else if (Date.now() - openingAt.current > 120_000) void finish("Director did not deliver media within two minutes. You can retry the connection.", true);
      }, 250);
    } catch (error) {
      if (thisEpoch === epoch.current && !signal.aborted) await finish(error instanceof Error ? error.message : "The screening could not start.", true);
    }
  }, [finish, patch, progress, schedule]);

  useEffect(() => {
    mounted.current = true;
    const onPageHide = () => { void finish(); };
    window.addEventListener("pagehide", onPageHide);
    return () => { mounted.current = false; window.removeEventListener("pagehide", onPageHide); void finish(); };
  }, [finish]);

  return { ...state, start, steer, stop, setTranslatorMode };
}
