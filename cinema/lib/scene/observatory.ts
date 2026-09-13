import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeSpecimen } from './fly-model';
import { makeDreamMaterial } from './dream-material';
import { makeNightCity } from './night-city';
import type { BrainSnapshot, Drive, StimulusKind } from '../types';

export type ViewName = 'room' | 'specimen' | 'cinema';
export type SceneAction = { kind: 'view'; view: ViewName } | { kind: 'stimulus'; stimulus: StimulusKind };
export const INPUTS = [
  { kind: 'sugar', label: 'SUGAR', color: '#efb56b' },
  { kind: 'bitter', label: 'BITTER', color: '#b79adb' },
  { kind: 'loom', label: 'SHADOW', color: '#ee8a83' },
  { kind: 'touch', label: 'TOUCH', color: '#8cbfd3' },
  { kind: 'odor', label: 'ODOR', color: '#b0c983' },
] as const;
const MOODS: Record<Drive, number> = { quiet: 0, appetite: 1, aversion: 2, escape: 3, groom: 4, explore: 5 };
type Vec = [number, number, number];

export function createObservatory() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#091214');
  scene.fog = new THREE.FogExp2('#091214', 0.021);
  const textures = new Set<THREE.Texture>();
  const pickables: THREE.Object3D[] = [];
  const brass = new THREE.MeshStandardMaterial({ color: '#a28a5d', metalness: 0.78, roughness: 0.28 });
  const edge = new THREE.MeshStandardMaterial({ color: '#485858', metalness: 0.78, roughness: 0.3 });
  const charcoal = new THREE.MeshStandardMaterial({ color: '#18272a', metalness: 0.5, roughness: 0.38 });
  const enamel = new THREE.MeshStandardMaterial({ color: '#b9b7a7', metalness: 0.34, roughness: 0.34 });
  const black = new THREE.MeshStandardMaterial({ color: '#050b0c', roughness: 0.64 });
  const green = new THREE.MeshStandardMaterial({ color: '#8ecbb5', emissive: '#8ecbb5', emissiveIntensity: 1.8 });
  const amber = new THREE.MeshStandardMaterial({ color: '#efc991', emissive: '#efc991', emissiveIntensity: 2.0 });

  function box(parent: THREE.Object3D, size: Vec, at: Vec, material: THREE.Material, radius = 0.04) {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 2, radius), material);
    mesh.position.set(...at); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  }
  function cylinder(parent: THREE.Object3D, radius: number, height: number, at: Vec, material: THREE.Material, radial = 80) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radial), material);
    mesh.position.set(...at); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  }
  function tube(parent: THREE.Object3D, points: Vec[], radius: number, material: THREE.Material) {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 56, radius, 8, false), material);
    mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  function ring(parent: THREE.Object3D, radius: number, width: number, at: Vec, material: THREE.Material, horizontal = true, arc = Math.PI * 2) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, width, 8, 120, arc), material);
    mesh.position.set(...at); if (horizontal) mesh.rotation.x = -Math.PI / 2; parent.add(mesh); return mesh;
  }
  function label(parent: THREE.Object3D, text: string, width: number, height: number, at: Vec, color = '#94a7a0', flat = false) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = Math.max(64, Math.round(1024 * height / width));
    const ctx = canvas.getContext('2d')!;
    ctx.font = '500 ' + Math.round(canvas.height * 0.46) + 'px monospace';
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 512, canvas.height / 2, 1000);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    mesh.position.set(...at); if (flat) mesh.rotation.x = -Math.PI / 2; parent.add(mesh); return mesh;
  }
  function target(size: Vec, at: Vec, action: SceneAction, title: string) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
    mesh.position.set(...at); mesh.userData = { action, title }; scene.add(mesh); pickables.push(mesh); return mesh;
  }

  // A complete room, with an inset wall and a suspended architectural light.
  box(scene, [70, 0.2, 70], [0, -2.35, 0], new THREE.MeshStandardMaterial({ color: '#101b1d', metalness: 0.28, roughness: 0.48 }));
  // Split the wall around a real opening so the skyline has depth when orbiting.
  box(scene, [22, 16, 0.4], [-24, 5, -9], charcoal);
  box(scene, [22, 16, 0.4], [24, 5, -9], charcoal);
  box(scene, [26, 4, 0.4], [0, -1, -9], charcoal);
  box(scene, [26, 3, 0.4], [0, 11.5, -9], charcoal);
  scene.add(makeNightCity());
  const seam = new THREE.MeshStandardMaterial({ color: '#142220', roughness: 0.8 });
  for (let x = -33; x <= 33; x += 3) {
    if (Math.abs(x) > 13) box(scene, [0.035, 13, 0.02], [x, 4, -8.785], seam, 0.005);
  }
  for (const y of [1, 10]) box(scene, [26.4, 0.16, 0.55], [0, y, -8.75], edge);
  for (const x of [-13, -6.5, 0, 6.5, 13]) box(scene, [0.12, 9, 0.45], [x, 5.5, -8.75], edge);
  box(scene, [26.6, 0.20, 1.0], [0, 0.92, -8.45], charcoal);
  for (const x of [-7.5, 7.5]) {
    box(scene, [0.08, 8, 0.08], [x, 3, -7.5], brass);
    box(scene, [0.025, 5.8, 0.04], [x, 3.3, -7.43], green, 0.008);
  }
  box(scene, [12, 0.15, 0.8], [0, 7.8, -1.2], charcoal);
  box(scene, [11.6, 0.035, 0.46], [0, 7.70, -1.2], amber, 0.014);
  for (const x of [-5, 5]) cylinder(scene, 0.014, 5, [x, 10.3, -1.2], edge, 8);

  // Floating laboratory table: bevels, a brass reveal, and sculptural supports.
  box(scene, [15.6, 0.44, 7.3], [0, -0.12, 0], charcoal, 0.18);
  box(scene, [15.3, 0.045, 7.05], [0, 0.13, 0], edge, 0.09);
  box(scene, [15.1, 0.035, 6.9], [0, 0.17, 0], new THREE.MeshStandardMaterial({ color: '#233130', roughness: 0.36, metalness: 0.44 }), 0.09);
  box(scene, [15.2, 0.022, 0.025], [0, -0.10, 3.66], brass, 0.008);
  for (const x of [-5.8, 5.8]) {
    box(scene, [0.35, 2.0, 5.4], [x, -1.25, 0], charcoal, 0.1);
    box(scene, [0.06, 1.7, 0.09], [x + 0.20, -1.3, 2.4], brass);
  }
  // Inlaid ruler and fasteners give the miniature a tangible scale.
  for (let i = 0; i <= 50; i++) box(scene, [0.012, 0.006, i % 5 === 0 ? 0.18 : 0.09], [-6.7 + i * 0.12, 0.192, 3.1], brass, 0.002);
  for (const x of [-7.35, 7.35]) for (const z of [-3.22, 3.22]) {
    cylinder(scene, 0.045, 0.012, [x, 0.205, z], brass, 12);
    box(scene, [0.054, 0.004, 0.01], [x, 0.214, z], black, 0.002);
  }

  // Specimen platform, concentric indexing rings, and an illuminated assay arm.
  cylinder(scene, 2.24, 0.20, [-3.75, 0.30, 0.2], black);
  cylinder(scene, 2.20, 0.06, [-3.75, 0.43, 0.2], brass);
  cylinder(scene, 2.12, 0.25, [-3.75, 0.59, 0.2], charcoal);
  cylinder(scene, 2.04, 0.025, [-3.75, 0.73, 0.2], new THREE.MeshPhysicalMaterial({ color: '#32413c', metalness: 0.45, roughness: 0.3, clearcoat: 0.7 }));
  ring(scene, 2.14, 0.014, [-3.75, 0.735, 0.2], green);
  ring(scene, 1.88, 0.007, [-3.75, 0.75, 0.2], brass);
  for (let i = 0; i < 72; i++) {
    const angle = i / 72 * Math.PI * 2;
    const tick = box(scene, [0.011, 0.006, i % 6 === 0 ? 0.13 : 0.055], [-3.75 + Math.sin(angle) * 1.99, 0.75, 0.2 + Math.cos(angle) * 1.99], brass, 0.002);
    tick.rotation.y = angle;
  }
  const fly = makeSpecimen();
  fly.specimen.name = 'specimen';
  fly.connector.name = 'neural-connector';
  fly.proboscis.name = 'proboscis';
  fly.specimen.position.set(-3.55, 1.725, 0.35); fly.specimen.scale.setScalar(1.05);
  scene.add(fly.specimen);
  target([3.9, 2.0, 2.7], [-3.65, 1.8, 0.35], { kind: 'view', view: 'specimen' }, 'Specimen 001 · inspect');
  tube(scene, [[-6.4, 0.2, -1.2], [-6.4, 3.6, -1.2], [-5.8, 4.2, -1.2], [-3.0, 4.2, -1.2]], 0.045, brass);
  box(scene, [2.4, 0.12, 0.34], [-3.8, 4.18, -1.2], charcoal);
  box(scene, [2.2, 0.025, 0.25], [-3.8, 4.10, -1.2], amber, 0.01);
  label(scene, 'D. MELANOGASTER  /  001', 2.8, 0.18, [-3.75, 0.198, 2.83], '#aeb8a1', true);

  // The entire cinema is geometry. The picture is a material on its glass face.
  const monitor = new THREE.Group(); monitor.position.set(3.0, 2.78, -0.65); scene.add(monitor);
  box(monitor, [6.08, 3.9, 0.54], [0, 0, 0], charcoal, 0.19);
  box(monitor, [6.0, 3.82, 0.15], [0, 0, 0.30], enamel, 0.17);
  box(monitor, [5.53, 3.21, 0.07], [-0.05, 0.13, 0.40], brass, 0.12);
  box(monitor, [5.43, 3.11, 0.05], [-0.05, 0.13, 0.45], black, 0.10);
  const dream = makeDreamMaterial();
  const screen = new THREE.Mesh<THREE.PlaneGeometry, THREE.Material>(new THREE.PlaneGeometry(5.29, 2.976), dream);
  screen.position.set(-0.05, 0.13, 0.482); monitor.add(screen);
  label(monitor, 'F / T     NEURAL CINEMA', 2.1, 0.17, [-1.56, -1.64, 0.401], '#394946');
  label(monitor, 'MODEL 01', 0.7, 0.12, [1.60, -1.64, 0.401], '#394946');
  const powerLight = new THREE.Mesh(new THREE.SphereGeometry(0.027, 12, 8), green);
  powerLight.position.set(-2.77, -1.64, 0.405); monitor.add(powerLight);
  const dial = cylinder(monitor, 0.12, 0.08, [2.47, -1.62, 0.44], brass, 32); dial.rotation.x = Math.PI / 2;
  for (let i = 0; i < 24; i++) box(monitor, [0.04, 0.48, 0.025], [-2.25 + i * 0.195, -0.65, -0.29], black, 0.01);
  box(scene, [0.30, 1.0, 0.48], [3, 0.67, -0.72], brass, 0.06);
  box(scene, [2.55, 0.14, 1.3], [3, 0.27, -0.6], charcoal, 0.1);
  box(scene, [2.38, 0.022, 1.16], [3, 0.35, -0.6], brass, 0.07);
  target([6.08, 3.90, 0.7], [3, 2.78, -0.55], { kind: 'view', view: 'cinema' }, 'Neural cinema · take a closer look');
  // Seat the plug inside the flat side wall, away from the rounded front edge.
  const plug = cylinder(monitor, 0.082, 0.26, [-3.08, -1.06, 0], brass, 24); plug.rotation.z = Math.PI / 2;
  const socketAnchor = new THREE.Object3D();
  socketAnchor.name = 'monitor-cable-socket';
  socketAnchor.position.set(-3.20, -1.06, 0); monitor.add(socketAnchor);
  const socket = socketAnchor.getWorldPosition(new THREE.Vector3());
  const screenLight = new THREE.PointLight('#eabb82', 16, 10, 2); screenLight.position.set(2.8, 2.7, 1.1); scene.add(screenLight);

  // Five physical, raycastable inputs share exactly the same handler as the accessible controls.
  const inputCaps: THREE.Mesh[] = [];
  const inputMaterials: THREE.MeshStandardMaterial[] = [];
  box(scene, [4.55, 0.23, 1.02], [2.9, 0.30, 2.25], charcoal, 0.12);
  box(scene, [4.42, 0.026, 0.91], [2.9, 0.43, 2.25], edge, 0.07);
  INPUTS.forEach((input, i) => {
    const x = 1.20 + i * 0.85;
    cylinder(scene, 0.225, 0.05, [x, 0.47, 2.12], black, 32);
    ring(scene, 0.206, 0.017, [x, 0.50, 2.12], brass);
    const material = new THREE.MeshStandardMaterial({ color: input.color, emissive: input.color, emissiveIntensity: 0.18, roughness: 0.3, metalness: 0.3 });
    inputMaterials.push(material);
    const cap = cylinder(scene, 0.173, 0.10, [x, 0.54, 2.12], material, 32); inputCaps.push(cap);
    label(scene, input.label, 0.63, 0.16, [x, 0.451, 2.52], '#c0ccc1', true);
    target([0.67, 0.45, 0.8], [x, 0.55, 2.20], { kind: 'stimulus', stimulus: input.kind }, input.label.charAt(0) + input.label.slice(1).toLowerCase() + ' · apply stimulus');
  });

  // A genuine live trace on a small instrument, rather than an animated fake waveform.
  const scopeCanvas = document.createElement('canvas'); scopeCanvas.width = 768; scopeCanvas.height = 256;
  const scopeContext = scopeCanvas.getContext('2d')!;
  const scopeTexture = new THREE.CanvasTexture(scopeCanvas); scopeTexture.colorSpace = THREE.SRGBColorSpace; textures.add(scopeTexture);
  box(scene, [2.5, 0.23, 1.03], [-0.9, 0.31, 2.25], charcoal, 0.1);
  const scope = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 0.75), new THREE.MeshBasicMaterial({ map: scopeTexture, toneMapped: false }));
  scope.rotation.x = -Math.PI / 2; scope.position.set(-0.9, 0.44, 2.25); scene.add(scope);

  // A direct suspended connection: no tabletop loop hidden by the plinth.
  const cableStart = new THREE.Vector3();
  const cableExit = new THREE.Vector3();
  const cableEntry = new THREE.Vector3();
  const cableCurve = new THREE.CubicBezierCurve3(cableStart, cableExit, cableEntry, socket);
  const segments = 100, sides = 8;
  const cableGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array((segments + 1) * (sides + 1) * 3);
  const normals = new Float32Array(positions.length);
  const indices: number[] = [];
  for (let s = 0; s < segments; s++) for (let j = 0; j < sides; j++) {
    const a = s * (sides + 1) + j, b = a + sides + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  cableGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  cableGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  cableGeometry.setIndex(indices);
  const cable = new THREE.Mesh(cableGeometry, new THREE.MeshStandardMaterial({ color: '#7f9e89', metalness: 0.62, roughness: 0.27 }));
  cable.name = 'neural-cable';
  cable.castShadow = true; cable.frustumCulled = false; scene.add(cable);
  const center = new THREE.Vector3(), tangent = new THREE.Vector3(), normal = new THREE.Vector3(), binormal = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 0, 1);
  const pulseGeometry = new THREE.SphereGeometry(0.026, 10, 8);
  const pulseMaterial = new THREE.MeshStandardMaterial({ color: '#c2ead8', emissive: '#91d8b9', emissiveIntensity: 1.4, roughness: 0.4 });
  const pulses = Array.from({ length: 10 }, (_, i) => {
    const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
    pulse.name = `signal-pulse-${i}`; scene.add(pulse); return pulse;
  });
  function updateCable() {
    fly.connector.getWorldPosition(cableStart);
    socketAnchor.getWorldPosition(socket);
    cableExit.copy(cableStart).add(new THREE.Vector3(0.35, 0.45, 0));
    cableEntry.copy(socket).add(new THREE.Vector3(-0.55, 0, 0));
    cableCurve.updateArcLengths();
    for (let s = 0; s <= segments; s++) {
      cableCurve.getPoint(s / segments, center); cableCurve.getTangent(s / segments, tangent);
      normal.crossVectors(tangent, axis).normalize(); binormal.crossVectors(tangent, normal).normalize();
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2, c = Math.cos(angle), q = Math.sin(angle);
        const k = (s * (sides + 1) + j) * 3;
        normals[k] = normal.x * c + binormal.x * q; normals[k + 1] = normal.y * c + binormal.y * q; normals[k + 2] = normal.z * c + binormal.z * q;
        positions[k] = center.x + normals[k] * 0.018; positions[k + 1] = center.y + normals[k + 1] * 0.018; positions[k + 2] = center.z + normals[k + 2] * 0.018;
      }
    }
    cableGeometry.attributes.position.needsUpdate = true; cableGeometry.attributes.normal.needsUpdate = true;
  }

  // Glass sample vials and notes are modeled props, visible from every angle.
  for (let i = 0; i < 3; i++) {
    const x = -6.65 + i * 0.37;
    const vialMaterial = new THREE.MeshPhysicalMaterial({ color: '#afcac1', metalness: 0.06, roughness: 0.13, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
    cylinder(scene, 0.13, 0.60 + i * 0.08, [x, 0.50, -2.5], vialMaterial, 24);
    cylinder(scene, 0.11, 0.20 + i * 0.08, [x, 0.31, -2.5], new THREE.MeshStandardMaterial({ color: INPUTS[i].color, emissive: INPUTS[i].color, emissiveIntensity: 0.1 }), 24);
    cylinder(scene, 0.145, 0.06, [x, 0.83 + i * 0.04, -2.5], brass, 24);
  }
  const note = box(scene, [1.65, 0.015, 1.1], [6.25, 0.21, 1.75], new THREE.MeshStandardMaterial({ color: '#b0ac8d', roughness: 0.95 }), 0.012);
  note.rotation.y = -0.12;
  const noteText = label(scene, 'OBSERVATION NO. 001', 1.4, 0.12, [6.25, 0.223, 1.48], '#3b443c', true); noteText.rotation.z = 0.12;
  tube(scene, [[5.9, 0.245, 2.42], [6.7, 0.245, 2.24]], 0.032, brass);

  // A restrained starfield of dust in the room; never presented as neural activity.
  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(100 * 3);
  let seed = 4201;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  for (let i = 0; i < dustPositions.length; i += 3) {
    dustPositions[i] = (random() - 0.5) * 25; dustPositions[i + 1] = random() * 10; dustPositions[i + 2] = (random() - 0.5) * 14;
  }
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: '#c5ccb6', size: 0.022, transparent: true, opacity: 0.38, depthWrite: false }));
  scene.add(dust);

  scene.add(new THREE.HemisphereLight('#c0ded4', '#383427', 0.7));
  const key = new THREE.DirectionalLight('#ffdeaa', 2.8); key.position.set(-3, 8, 5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -10; key.shadow.camera.right = 10;
  key.shadow.camera.top = 8; key.shadow.camera.bottom = -8; key.shadow.normalBias = 0.025; key.shadow.bias = -0.0001;
  key.shadow.radius = 3; scene.add(key);
  const rim = new THREE.DirectionalLight('#82c9c7', 2.5); rim.position.set(5, 5, -5); scene.add(rim);
  const specimenLight = new THREE.PointLight('#ffd199', 3.5, 8, 2); specimenLight.position.set(-4, 3.7, 0); scene.add(specimenLight);

  let energy = 0, lastTrace = -1, lastScopeKey = '', pulseDistance = 0;
  const lampColor = new THREE.Color();
  const trace: number[] = Array(64).fill(0);
  let lastTrial: number | undefined;

  function update(time: number, dt: number, activity: number, drive: Drive, rawDrive: Drive, snapshot: BrainSnapshot, activeInput: string | null, reduced: boolean, paused: boolean, hovered: THREE.Object3D | null) {
    energy = THREE.MathUtils.damp(energy, activity, 3, dt);
    const motion = reduced ? 0 : 1;
    const feed = rawDrive === 'appetite' ? energy : 0, alarm = rawDrive === 'escape' ? energy : 0;
    fly.abdomen.scale.y = 1 + Math.sin(time * 1.7) * 0.012 * motion;
    fly.head.rotation.y = Math.sin(time * 0.73) * 0.028 * motion;
    fly.head.rotation.z = (Math.sin(time * 1.07) * 0.012 - feed * 0.04) * motion;
    fly.proboscis.rotation.z = -feed * (0.23 + Math.sin(time * 3.4) * 0.06) * motion;
    fly.wings.forEach((wing, i) => { const side = i ? 1 : -1; wing.rotation.x = side * (-0.065 + Math.sin(time * (17 + energy * 20)) * (energy * 0.035 + alarm * 0.18) * motion); });
    fly.antennae.forEach((antenna, i) => { antenna.rotation.z = Math.sin(time * 2.3 + i * 1.8) * (0.045 + energy * 0.05) * motion; });
    fly.legs.forEach((leg, i) => {
      leg.rotation.z = Math.sin(time * 1.2 + i * 1.8) * (0.005 + energy * 0.016) * motion;
      if (rawDrive === 'groom' && i % 3 === 0) leg.rotation.z += Math.sin(time * 5) * energy * 0.09 * motion;
    });
    fly.connectorMaterial.emissiveIntensity = 0.35 + energy * 1.2;
    dream.uniforms.uMood.value = MOODS[drive]; dream.uniforms.uEnergy.value = energy;
    if (!paused && !reduced) dream.uniforms.uTime.value += dt;
    lampColor.set(drive === 'appetite' ? '#f6b76d' : drive === 'escape' ? '#ed8577' : drive === 'aversion' ? '#bd96d6' : '#91c4b3');
    screenLight.color.lerp(lampColor, Math.min(1, dt * 2));
    dust.rotation.y = time * 0.007 * motion;
    inputCaps.forEach((cap, i) => {
      const active = activeInput === INPUTS[i].kind;
      const hover = hovered?.userData.action?.stimulus === INPUTS[i].kind;
      cap.position.y = THREE.MathUtils.damp(cap.position.y, active ? 0.505 : 0.54, 12, dt);
      inputMaterials[i].emissiveIntensity = THREE.MathUtils.damp(inputMaterials[i].emissiveIntensity, active ? 1.7 : hover ? 0.9 : 0.18, 8, dt);
    });
    updateCable();
    // Integrate distance, never multiply elapsed time by a changing neural value:
    // that jumps the entire stream whenever activity changes. Arc length keeps
    // spacing and speed uniform through both tight bends and long straight runs.
    const cableLength = cableCurve.getLength();
    pulseDistance = (pulseDistance + Math.min(dt, 0.05) * 0.8 * motion) % cableLength;
    pulses.forEach((pulse, i) => {
      pulse.visible = snapshot.source === 'connectome' && energy > 0.025;
      cableCurve.getPointAt((pulseDistance / cableLength + i / pulses.length) % 1, pulse.position);
    });
    const trial = (snapshot as BrainSnapshot & { trial?: number }).trial;
    if (trial !== lastTrial || snapshot.source !== 'connectome') trace.fill(0);
    lastTrial = trial;
    if (snapshot.sequence !== lastTrace) { trace.shift(); trace.push(snapshot.totalSpikes); lastTrace = snapshot.sequence; }
    const scopeKey = snapshot.source + ':' + snapshot.sequence + ':' + trial;
    if (scopeKey !== lastScopeKey) {
      lastScopeKey = scopeKey;
      const ctx = scopeContext; ctx.fillStyle = '#071614'; ctx.fillRect(0, 0, 768, 256);
      ctx.strokeStyle = '#16352e'; ctx.lineWidth = 1;
      for (let i = 0; i < 768; i += 48) { ctx.beginPath(); ctx.moveTo(i, 60); ctx.lineTo(i, 232); ctx.stroke(); }
      ctx.fillStyle = '#9fc9b4'; ctx.font = '22px monospace'; ctx.fillText('NEURAL ACTIVITY', 24, 38);
      ctx.textAlign = 'right'; ctx.fillText(snapshot.source === 'connectome' ? snapshot.totalSpikes.toLocaleString() + ' / 50 ms' : 'OFFLINE', 744, 38); ctx.textAlign = 'left';
      const max = Math.max(500, ...trace); ctx.strokeStyle = '#93e0b4'; ctx.lineWidth = 3; ctx.beginPath();
      trace.forEach((value, i) => { const x = 24 + i * 720 / 63, y = 218 - value / max * 140; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
      scopeTexture.needsUpdate = true;
    }
  }

  function dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        if (object instanceof THREE.InstancedMesh) object.dispose();
      }
    });
    // Screen may currently have the video material, so its study material is tracked explicitly.
    materials.add(dream);
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    key.shadow.map?.dispose();
  }
  updateCable();
  return { scene, screen, dream, pickables, update, dispose };
}
