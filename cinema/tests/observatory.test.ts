import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createObservatory, INPUTS } from '../lib/scene/observatory';
import { EMPTY_BRAIN } from '../lib/types';

// Only canvas text drawing is stubbed. Geometry, transforms, raycasts,
// neural updates and cable vertices below are real Three.js objects.
function harness() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = {
    fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ ...context }) }),
  } });
  const world = createObservatory();
  return {
    ...world,
    close() {
      world.dispose();
      if (previous) Object.defineProperty(globalThis, 'document', previous);
      else Reflect.deleteProperty(globalThis, 'document');
    },
  };
}

test('all five physical inputs can be raycast and dispatch the original stimulus identities', () => {
  const world = harness();
  try {
    world.scene.updateMatrixWorld(true);
    INPUTS.forEach((input, i) => {
      const ray = new THREE.Raycaster(new THREE.Vector3(1.2 + i * 0.85, 5, 2.12), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(world.pickables, false)[0];
      assert.ok(hit, input.kind + ' must have a reachable physical input');
      assert.deepEqual(hit.object.userData.action, { kind: 'stimulus', stimulus: input.kind });
    });
  } finally { world.close(); }
});

test('the cable stays attached in world coordinates as the head moves', () => {
  const world = harness();
  try {
    const cable = world.scene.getObjectByName('neural-cable') as THREE.Mesh<THREE.BufferGeometry>;
    const connector = world.scene.getObjectByName('neural-connector')!;
    const previous = connector.getWorldPosition(new THREE.Vector3());
    world.update(1.2, 0.1, 1, 'escape', 'appetite', EMPTY_BRAIN, null, false, false, null);
    const current = connector.getWorldPosition(new THREE.Vector3());
    assert.ok(current.distanceTo(previous) > 0.001, 'the connector must actually move during this check');
    const positions = cable.geometry.getAttribute('position');
    const center = new THREE.Vector3();
    for (let i = 0; i < 8; i++) center.add(new THREE.Vector3().fromBufferAttribute(positions, i));
    center.divideScalar(8);
    assert.ok(center.distanceTo(current) < 0.00001, 'the cable begins at the animated head, without a DOM projection');
  } finally { world.close(); }
});

test('monitor endpoint is seated and signal motion stays continuous when activity changes', () => {
  const world = harness();
  try {
    const snapshot = { ...EMPTY_BRAIN, source: 'connectome' as const };
    world.update(1000, 0.025, 0.2, 'quiet', 'quiet', snapshot, null, false, false, null);
    const pulse = world.scene.getObjectByName('signal-pulse-5')!;
    const before = pulse.position.clone();
    world.update(1000.025, 0.025, 1, 'quiet', 'quiet', snapshot, null, false, false, null);
    assert.ok(pulse.position.distanceTo(before) < 0.025, 'an activity change must not jump the stream forward or backward');
    const cable = world.scene.getObjectByName('neural-cable') as THREE.Mesh<THREE.BufferGeometry>;
    const positions = cable.geometry.getAttribute('position');
    const end = new THREE.Vector3();
    for (let i = positions.count - 9; i < positions.count - 1; i++) end.add(new THREE.Vector3().fromBufferAttribute(positions, i));
    end.divideScalar(8);
    const socket = world.scene.getObjectByName('monitor-cable-socket')!;
    assert.ok(end.distanceTo(socket.getWorldPosition(new THREE.Vector3())) < 0.00001);
    assert.ok(socket.parent, 'socket belongs to the monitor assembly');
    const start = world.scene.getObjectByName('neural-connector')!.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < positions.count; i++) {
      assert.ok(positions.getY(i) >= Math.min(start.y, end.y) - 0.02, 'the wire must stay suspended between endpoints, above the plinth');
      assert.ok(positions.getX(i) >= start.x - 0.02 && positions.getX(i) <= end.x + 0.02, 'the wire must take a direct route without doubling back');
    }
  } finally { world.close(); }
});

test('editorial scene holds do not replace raw neural pose and pause stops the study clock', () => {
  const world = harness();
  try {
    world.update(1, 0.1, 1, 'escape', 'appetite', EMPTY_BRAIN, null, false, false, null);
    const proboscis = world.scene.getObjectByName('proboscis')!;
    assert.ok(proboscis.rotation.z < 0, 'fresh feeding evidence must animate the fly during a held escape scene');
    assert.equal(world.dream.uniforms.uMood.value, 3, 'the picture retains its selected editorial scene');
    const before = world.dream.uniforms.uTime.value;
    world.update(2, 0.1, 1, 'escape', 'appetite', EMPTY_BRAIN, null, false, true, null);
    assert.equal(world.dream.uniforms.uTime.value, before, 'pause freezes the screen study');
    world.update(3, 0.1, 1, 'escape', 'appetite', EMPTY_BRAIN, null, true, false, null);
    assert.equal(world.dream.uniforms.uTime.value, before, 'reduced motion also freezes the study');
    assert.equal(Math.abs(proboscis.rotation.z), 0, 'reduced motion disables pose animation');
  } finally { world.close(); }
});

