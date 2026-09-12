import type { BrainSnapshot } from "../types";
import type { TranslatorMode } from "../director-scheduling";
import { RequestError } from "./guards";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("Invalid telemetry object.");
  return value as Record<string, unknown>;
};
function number(value: unknown, field: string, maximum = 1e15, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new RequestError(`Invalid ${field}.`);
  return value;
}
function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum || !value.trim()) throw new RequestError(`Invalid ${field}.`);
  return value.trim();
}

export function parseDirectorInput(value: unknown): { telemetry: BrainSnapshot; history: string[]; start: boolean; mode: TranslatorMode } {
  const body = object(value);
  const raw = object(body.telemetry);
  if (raw.source !== "connectome" && raw.source !== "preview") throw new RequestError("Invalid telemetry source.");
  if (!Array.isArray(raw.populations) || raw.populations.length > 64) throw new RequestError("Invalid populations.");
  const motors = object(raw.motors);
  const stimulus = object(raw.stimulus);
  if (body.start !== undefined && typeof body.start !== "boolean") throw new RequestError("Invalid start flag.");
  if (body.mode !== undefined && body.mode !== "direct" && body.mode !== "llm") throw new RequestError("Invalid translator mode.");
  if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 6)) throw new RequestError("History must contain at most six scenes.");
  const history = ((body.history ?? []) as unknown[]).map(item => text(item, "history entry", 1_200));
  const telemetry = {
    source: raw.source,
    timestamp: number(raw.timestamp, "timestamp"),
    sequence: number(raw.sequence, "sequence"),
    simulatedMs: number(raw.simulatedMs, "simulation time"),
    neurons: number(raw.neurons, "neuron count", 10_000_000),
    edges: number(raw.edges, "edge count", 1_000_000_000),
    totalSpikes: number(raw.totalSpikes, "spike count"),
    activeNeurons: number(raw.activeNeurons, "active neurons", 10_000_000),
    realTimeFactor: number(raw.realTimeFactor, "real-time factor", 100_000),
    populations: raw.populations.map(value => {
      const population = object(value);
      return { name: text(population.name, "population name", 64), hz: number(population.hz, "population firing rate", 100_000), count: number(population.count, "population size", 10_000_000) };
    }),
    motors: {
      forward: number(motors.forward, "forward", 1_000, -1_000),
      yaw: number(motors.yaw, "yaw", 1_000, -1_000),
      feed: number(motors.feed, "feed", 1_000),
      groom: number(motors.groom, "groom", 1_000),
      escape: number(motors.escape, "escape", 1_000),
      flight: number(motors.flight, "flight", 1_000),
    },
    stimulus: { kind: text(stimulus.kind, "stimulus kind", 40), intensity: number(stimulus.intensity, "stimulus intensity", 100), remainingMs: number(stimulus.remainingMs, "stimulus duration", 3_600_000) },
  } as BrainSnapshot;
  return { telemetry, history, start: body.start === true, mode: body.mode === "llm" ? "llm" : "direct" };
}
