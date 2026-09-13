import type { CinematicDirection } from "./cinematic";

export type TranslatorMode = "direct" | "llm";
export const FAST_STEER_INTERVAL_MS = 800;
export const CONTINUATION_INTERVAL_MS = 12_000;

export function directionKey(direction: Pick<CinematicDirection, "drive" | "sensoryTheme" | "responseKey">): string {
  return `${direction.drive}:${direction.sensoryTheme ?? "none"}${direction.responseKey ? ":" + direction.responseKey : ""}`;
}

export interface DirectorLatency {
  observedToSentMs: number | null;
  sentToAcceptedMs: number | null;
  sentToGeneratedMs: number | null;
  observedToGeneratedMs: number | null;
  lastSentAt: number | null;
  lastAcceptedAt: number | null;
  lastGeneratedAt: number | null;
}
export const EMPTY_LATENCY: DirectorLatency = {
  observedToSentMs: null, sentToAcceptedMs: null, sentToGeneratedMs: null,
  observedToGeneratedMs: null, lastSentAt: null, lastAcceptedAt: null, lastGeneratedAt: null,
};

/** One provider admission at a time. New observations replace, rather than queue, old ones. */
export class DirectorScheduler {
  latestKey: string | null = null;
  lastSentKey: string | null = null;
  pendingVersion = 0;
  private observedAt = 0;
  private latestObservedAt = 0;
  private sentAt = 0;
  private terminalVersion = 0;
  private records = new Map<number, { observedAt: number; sentAt: number; acceptedAt?: number; generatedAt?: number }>();
  private measurements: DirectorLatency = { ...EMPTY_LATENCY };

  observe(key: string, now: number): void {
    if (key !== this.latestKey) this.observedAt = now;
    this.latestObservedAt = now;
    this.latestKey = key;
  }

  next(now: number): { kind: "change" | "continuation"; waitMs: number } | null {
    if (this.latestKey === null || this.pendingVersion > 0) return null;
    const changed = this.latestKey !== this.lastSentKey;
    const interval = changed ? FAST_STEER_INTERVAL_MS : CONTINUATION_INTERVAL_MS;
    return { kind: changed ? "change" : "continuation", waitMs: this.lastSentKey === null ? 0 : Math.max(0, this.sentAt + interval - now) };
  }

  sent(version: number, key: string, now: number): void {
    if (this.pendingVersion > 0) throw new Error("A Director direction is already awaiting admission.");
    if (key !== this.latestKey) throw new Error("Cannot send a superseded Director direction.");
    const observedAt = key === this.lastSentKey ? this.latestObservedAt : this.observedAt;
    this.lastSentKey = key;
    this.sentAt = now;
    this.pendingVersion = version;
    this.records.set(version, { observedAt, sentAt: now });
    while (this.records.size > 256) this.records.delete(this.records.keys().next().value!);
    this.measurements = { ...this.measurements, observedToSentMs: Math.max(0, now - observedAt), lastSentAt: now };
  }

  pending(version: number): void {
    // A delayed pending notification must not resurrect an admitted/rejected version.
    if (version > this.terminalVersion && this.records.has(version)) this.pendingVersion = Math.max(this.pendingVersion, version);
  }

  accepted(version: number, now: number): void {
    const record = this.records.get(version);
    if (record && record.acceptedAt === undefined) {
      record.acceptedAt = now;
      this.measurements = { ...this.measurements, sentToAcceptedMs: Math.max(0, now - record.sentAt), lastAcceptedAt: now };
    }
    this.release(version);
  }

  rejected(version: number): void { this.release(version); }

  generated(version: number, now: number): void {
    const record = this.records.get(version);
    // First output measures response latency; subsequent chunks under the same
    // direction must not inflate that measurement.
    if (record && record.generatedAt === undefined) {
      record.generatedAt = now;
      this.measurements = { ...this.measurements, sentToGeneratedMs: Math.max(0, now - record.sentAt), observedToGeneratedMs: Math.max(0, now - record.observedAt), lastGeneratedAt: now };
    }
    // Generated output proves admission even if its ACK was lost.
    this.release(version);
  }

  private release(version: number): void {
    this.terminalVersion = Math.max(this.terminalVersion, version);
    if (version >= this.pendingVersion) this.pendingVersion = 0;
  }

  get latency(): DirectorLatency { return { ...this.measurements }; }
}
