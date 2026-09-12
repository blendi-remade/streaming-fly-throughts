import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_BRAIN } from '../lib/types';
import { readBrain } from '../lib/readings';

test('flight and turning are not presented as olfactory evidence', () => {
  const flight = readBrain({ ...EMPTY_BRAIN, source: 'connectome', motors: { ...EMPTY_BRAIN.motors, flight: .8 } });
  assert.equal(flight.circuit, 'FLIGHT MOTOR READOUT');
  const turning = readBrain({ ...EMPTY_BRAIN, source: 'connectome', motors: { ...EMPTY_BRAIN.motors, yaw: .8 } });
  assert.equal(turning.circuit, 'LOCOMOTOR / TURNING READOUT');
});
test('UI and cinematic translator preserve motor activity when a sensory input disagrees', () => {
  const reading = readBrain({ ...EMPTY_BRAIN, source: 'connectome', stimulus: { kind: 'sugar', intensity: .85, remainingMs: 1000 }, motors: { ...EMPTY_BRAIN.motors, escape: .9, feed: .1 } });
  assert.equal(reading.drive, 'escape');
  assert.match(reading.evidence, /escape readout/);
});
test('bitter metaphor follows measured receptors without claiming inhibition', () => {
  const reading = readBrain({ ...EMPTY_BRAIN, source: 'connectome', populations: [{ name: 'Bitter GRNs', hz: 40, count: 38 }] });
  assert.equal(reading.circuit, 'BITTER SENSORY ACTIVITY');
  assert.doesNotMatch(reading.circuit, /INHIBITION/);
  assert.match(reading.evidence, /does not establish/);
});
