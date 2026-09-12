export type StimulusKind = 'sugar' | 'bitter' | 'loom' | 'touch' | 'odor' | 'clear';
export type Drive = 'quiet' | 'appetite' | 'aversion' | 'escape' | 'groom' | 'explore';
export interface BrainSnapshot {
  source: 'connectome' | 'preview';
  timestamp: number;
  sequence: number;
  simulatedMs: number;
  neurons: number;
  edges: number;
  totalSpikes: number;
  activeNeurons: number;
  realTimeFactor: number;
  windowMs?: number;
  populations: { name: string; hz: number; count: number }[];
  motors: { forward: number; yaw: number; feed: number; groom: number; escape: number; flight: number };
  stimulus: { kind: string; intensity: number; remainingMs: number };
}
export interface Reading {
  drive: Drive;
  title: string;
  caption: string;
  circuit: string;
  strength: number;
  color: string;
  evidence: string;
}
export const EMPTY_BRAIN: BrainSnapshot = {
  source: 'preview', timestamp: 0, sequence: 0, simulatedMs: 0,
  neurons: 176422, edges: 6287749, totalSpikes: 0, activeNeurons: 0,
  realTimeFactor: 0, windowMs: 50, populations: [],
  motors: { forward: 0, yaw: 0, feed: 0, groom: 0, escape: 0, flight: 0 },
  stimulus: { kind: 'clear', intensity: 0, remainingMs: 0 },
};
