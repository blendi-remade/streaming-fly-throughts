import type { BrainSnapshot, Drive, Reading } from './types';
import { interpretBrain } from './cinematic';
export const READINGS: Record<Drive, Omit<Reading, 'strength' | 'evidence'>> = {
  quiet: { drive: 'quiet', title: 'A little room for wonder.', caption: 'Before a thought, a little electricity.', circuit: 'BASELINE', color: '#a6bfb3' },
  appetite: { drive: 'appetite', title: 'What if the sun was sugar?', caption: 'The whole universe, just within reach.', circuit: 'G2N-1 → FUDOG → MN9', color: '#f4a55f' },
  aversion: { drive: 'aversion', title: 'Something sweet turns strange.', caption: 'The same little world, in another light.', circuit: 'BITTER SENSORY ACTIVITY', color: '#c6a4d9' },
  escape: { drive: 'escape', title: 'The sky is coming closer.', caption: 'Small body. Enormous urgency.', circuit: 'LC4 / LPLC2 → GIANT FIBRE', color: '#ed8376' },
  groom: { drive: 'groom', title: 'Put the universe back in order.', caption: 'Every tiny hair, exactly where it belongs.', circuit: 'MECHANOSENSORY → aDN1 / aDN2', color: '#b5cad6' },
  explore: { drive: 'explore', title: 'There is something in the air.', caption: 'An invisible thread to somewhere wonderful.', circuit: 'OLFACTORY INPUT', color: '#b7ca75' },
};
export function populationRate(snapshot: BrainSnapshot, ...names: string[]): number {
  return Math.max(0, ...snapshot.populations.filter(p => names.some(n => p.name.toLowerCase().includes(n.toLowerCase()))).map(p => p.hz));
}
export function readBrain(snapshot: BrainSnapshot): Reading {
  const interpreted = interpretBrain(snapshot);
  const drives: Record<string, Drive> = { feed: 'appetite', escape: 'escape', groom: 'groom', flight: 'explore', explore: 'explore', rest: 'quiet' };
  let drive = drives[interpreted.drive] || 'quiet';
  let strength = Math.max(0, ...Object.values(snapshot.motors).filter(Number.isFinite).map(Math.abs));
  if (interpreted.drive === 'rest' || interpreted.drive === 'explore') {
    if (interpreted.sensoryTheme === 'bitter') { drive = 'aversion'; strength = Math.max(strength, populationRate(snapshot, 'Bitter GRNs') / 150); }
    if (interpreted.sensoryTheme === 'odor') { drive = 'explore'; strength = Math.max(strength, populationRate(snapshot, 'ORN_DM1') / 150); }
  }
  let circuit = READINGS[drive].circuit;
  if (drive === 'explore') circuit = interpreted.sensoryTheme === 'odor' ? 'OLFACTORY SENSORY ACTIVITY' : interpreted.drive === 'flight' ? 'FLIGHT MOTOR READOUT' : 'LOCOMOTOR / TURNING READOUT';
  return { ...READINGS[drive], circuit, strength: Math.min(1, strength), evidence: interpreted.evidence.join('. ') };
}
