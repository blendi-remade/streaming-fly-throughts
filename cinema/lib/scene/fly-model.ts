import * as THREE from "three";

type Point = [number, number, number];
type Bristle = { point: THREE.Vector3; direction: THREE.Vector3; length: number; radius?: number };

// This is an anatomical illustration, not a reconstruction of a particular fly.
// Neural activity changes its pose; anatomy never changes with the model's output.
export function makeSpecimen() {
  const specimen = new THREE.Group();
  let seed = 80426;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const sphere = new THREE.SphereGeometry(1, 36, 26);
  const amber = new THREE.MeshPhysicalMaterial({ color: "#846032", roughness: 0.47, metalness: 0.13, clearcoat: 0.24 });
  const honey = new THREE.MeshPhysicalMaterial({ color: "#ae8545", roughness: 0.43, metalness: 0.07, clearcoat: 0.28 });
  const dark = new THREE.MeshStandardMaterial({ color: "#383329", roughness: 0.64 });
  const legMaterial = new THREE.MeshPhysicalMaterial({ color: "#9c7942", roughness: 0.45, metalness: 0.09 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: "#3e3527", roughness: 0.8 });
  const pale = new THREE.MeshPhysicalMaterial({ color: "#d7b66a", roughness: 0.43, clearcoat: 0.2 });

  function ellipsoid(parent: THREE.Object3D, position: Point, scale: Point, material: THREE.Material) {
    const mesh = new THREE.Mesh(sphere, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function rod(parent: THREE.Object3D, from: Point, to: Point, radiusStart: number, radiusEnd: number, material: THREE.Material, sides = 8) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusEnd, radiusStart, direction.length(), sides), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function curve(parent: THREE.Object3D, points: Point[], radius: number, material: THREE.Material, segments = 30) {
    const path = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, segments, radius, 5, false), material);
    parent.add(mesh);
    return mesh;
  }

  function bristles(parent: THREE.Object3D, hairs: Bristle[]) {
    const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 3), hairMaterial, hairs.length);
    const transform = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    hairs.forEach((hair, index) => {
      transform.position.copy(hair.point).addScaledVector(hair.direction, hair.length * 0.5);
      transform.quaternion.setFromUnitVectors(up, hair.direction);
      transform.scale.set(hair.radius ?? 0.004, hair.length, hair.radius ?? 0.004);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
  }

  // A continuous abdomen surface, with bands following its cross section.
  const profile = [
    [-2.02, 0.025], [-1.9, 0.17], [-1.72, 0.28], [-1.45, 0.365],
    [-1.17, 0.405], [-0.87, 0.395], [-0.6, 0.315], [-0.4, 0.18],
  ];
  const radiusAt = (x: number) => {
    for (let i = 1; i < profile.length; i++) {
      if (x <= profile[i][0]) {
        const previous = profile[i - 1];
        return THREE.MathUtils.lerp(previous[1], profile[i][1], (x - previous[0]) / (profile[i][0] - previous[0]));
      }
    }
    return profile[profile.length - 1][1];
  };
  const abdomen = new THREE.Group();
  specimen.add(abdomen);
  const abdomenMaterials = [honey, new THREE.MeshPhysicalMaterial({ color: "#30291f", roughness: 0.46, clearcoat: 0.18 })];
  const bodyPositions: number[] = [];
  const bodyIndices: number[] = [];
  const bodyUVs: number[] = [];
  const rings = 100;
  const sides = 52;
  for (let ring = 0; ring <= rings; ring++) {
    const x = THREE.MathUtils.lerp(-2.02, -0.4, ring / rings);
    const radius = radiusAt(x);
    for (let side = 0; side <= sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      bodyPositions.push(x, 0.27 + Math.sin(angle) * radius * 0.78, Math.cos(angle) * radius);
      bodyUVs.push(ring / rings, side / sides);
    }
  }
  const abdomenGeometry = new THREE.BufferGeometry();
  let lastBodyMaterial = -1;
  for (let ring = 0; ring < rings; ring++) {
    const x = THREE.MathUtils.lerp(-2.02, -0.4, (ring + 0.5) / rings);
    const band = x < -1.64 || [-1.62, -1.35, -1.07, -0.78, -0.51].some((boundary) => x > boundary - 0.075 && x < boundary + 0.022);
    const start = bodyIndices.length;
    for (let side = 0; side < sides; side++) {
      const a = ring * (sides + 1) + side;
      const b = a + sides + 1;
      bodyIndices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const materialIndex = band ? 1 : 0;
    if (lastBodyMaterial === materialIndex) {
      abdomenGeometry.groups[abdomenGeometry.groups.length - 1].count += bodyIndices.length - start;
    } else {
      abdomenGeometry.addGroup(start, bodyIndices.length - start, materialIndex);
      lastBodyMaterial = materialIndex;
    }
  }
  abdomenGeometry.setAttribute("position", new THREE.Float32BufferAttribute(bodyPositions, 3));
  abdomenGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(bodyUVs, 2));
  abdomenGeometry.setIndex(bodyIndices);
  abdomenGeometry.computeVertexNormals();
  const abdomenMesh = new THREE.Mesh(abdomenGeometry, abdomenMaterials);
  abdomenMesh.castShadow = true;
  abdomenMesh.receiveShadow = true;
  abdomen.add(abdomenMesh);

  const abdominalHairs: Bristle[] = [];
  for (let i = 0; i < 310; i++) {
    const x = -1.94 + random() * 1.39;
    const angle = random() * Math.PI * 2;
    const r = radiusAt(x);
    const direction = new THREE.Vector3(-0.35, Math.sin(angle) * 0.85, Math.cos(angle)).normalize();
    abdominalHairs.push({ point: new THREE.Vector3(x, 0.27 + Math.sin(angle) * r * 0.78, Math.cos(angle) * r), direction, length: 0.025 + random() * 0.048, radius: 0.0025 });
  }
  bristles(abdomen, abdominalHairs);

  ellipsoid(specimen, [-0.14, 0.34, 0], [0.60, 0.46, 0.44], amber);
  ellipsoid(specimen, [-0.52, 0.55, 0], [0.23, 0.24, 0.32], honey); // scutellum
  ellipsoid(specimen, [0.33, 0.3, 0], [0.25, 0.3, 0.31], honey);
  const dorsalMaterial = new THREE.MeshStandardMaterial({ color: "#6d5635", roughness: 0.7 });
  for (const side of [-1, 1]) {
    curve(specimen, [[0.29, 0.655, side * 0.16], [0.10, 0.775, side * 0.17], [-0.18, 0.78, side * 0.16], [-0.40, 0.697, side * 0.13]], 0.022, dorsalMaterial);
  }
  const thoracicHairs: Bristle[] = [];
  for (let i = 0; i < 470; i++) {
    const z = 2 * random() - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const direction = new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z);
    thoracicHairs.push({
      point: new THREE.Vector3(-0.14 + direction.x * 0.602, 0.34 + direction.y * 0.462, direction.z * 0.442),
      direction: direction.clone().add(new THREE.Vector3(-0.25, 0.05, 0)).normalize(),
      length: 0.025 + random() * 0.055,
      radius: 0.0025,
    });
  }
  // The characteristic long macrochaetae along the thorax and scutellum.
  for (const side of [-1, 1]) {
    for (const x of [-0.55, -0.31, 0.08, 0.32]) {
      thoracicHairs.push({ point: new THREE.Vector3(x, 0.68, side * 0.23), direction: new THREE.Vector3(-0.34, 0.78, side * 0.45).normalize(), length: 0.17 + random() * 0.11, radius: 0.007 });
    }
  }
  bristles(specimen, thoracicHairs);

  // Head: two real compound-eye forms with individually oriented hexagonal facets.
  const head = new THREE.Group();
  head.position.set(0.68, 0.39, 0);
  specimen.add(head);
  ellipsoid(head, [0, 0, 0], [0.32, 0.31, 0.34], honey);
  ellipsoid(head, [0.26, -0.1, 0], [0.14, 0.20, 0.19], amber);
  const eyeMaterial = new THREE.MeshPhysicalMaterial({ color: "#6b1d18", roughness: 0.3, metalness: 0.10, clearcoat: 0.8, clearcoatRoughness: 0.25 });
  const facetMaterial = new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.38, metalness: 0.10, clearcoat: 0.62, clearcoatRoughness: 0.32 });
  const facetGeometry = new THREE.CircleGeometry(0.0135, 6);
  const temp = new THREE.Object3D();
  const normal = new THREE.Vector3();
  const front = new THREE.Vector3(0, 0, 1);
  const color = new THREE.Color();
  for (const side of [-1, 1]) {
    const eyeCenter = new THREE.Vector3(0.047, 0.045, side * 0.245);
    ellipsoid(head, eyeCenter.toArray() as Point, [0.278, 0.315, 0.187], eyeMaterial);
    const facets = new THREE.InstancedMesh(facetGeometry, facetMaterial, 950);
    for (let i = 0; i < 950; i++) {
      const z = 0.055 + (i / 950) * 0.945;
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const radial = Math.sqrt(1 - z * z);
      const x = Math.cos(angle) * radial;
      const y = Math.sin(angle) * radial;
      temp.position.set(eyeCenter.x + x * 0.28, eyeCenter.y + y * 0.317, eyeCenter.z + side * z * 0.189);
      normal.set(x / 0.28, y / 0.317, side * z / 0.189).normalize();
      temp.quaternion.setFromUnitVectors(front, normal);
      temp.scale.setScalar(0.86 + random() * 0.15);
      temp.updateMatrix();
      facets.setMatrixAt(i, temp.matrix);
      color.setHSL(0.005 + random() * 0.02, 0.76 + random() * 0.13, 0.125 + random() * 0.075);
      facets.setColorAt(i, color);
    }
    head.add(facets);
  }
  // Three ocelli, short antennae, and their delicate arista branches.
  for (const position of [[0.02, 0.292, -0.057], [0.02, 0.292, 0.057], [0.13, 0.282, 0]] as Point[]) {
    ellipsoid(head, position, [0.027, 0.019, 0.024], dark);
  }
  const antennae: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const antenna = new THREE.Group();
    antenna.position.set(0.267, 0.025, side * 0.10);
    head.add(antenna);
    antennae.push(antenna);
    ellipsoid(antenna, [0.039, 0.035, 0], [0.073, 0.053, 0.048], amber);
    const funiculus = ellipsoid(antenna, [0.113, 0.041, side * 0.007], [0.053, 0.089, 0.043], pale);
    funiculus.rotation.z = -0.25;
    curve(antenna, [[0.117, 0.087, 0], [0.15, 0.19, side * 0.034], [0.24, 0.31, side * 0.047]], 0.005, hairMaterial);
    const hairs: Bristle[] = [];
    for (let i = 0; i < 8; i++) {
      const t = i / 8;
      for (const branch of [-1, 1]) {
        hairs.push({ point: new THREE.Vector3(0.128 + t * 0.093, 0.12 + t * 0.173, side * t * 0.047), direction: new THREE.Vector3(branch * 0.9, 0.37, side * 0.22).normalize(), length: 0.085 * (1 - t * 0.65), radius: 0.0026 });
      }
    }
    bristles(antenna, hairs);
  }
  const proboscis = new THREE.Group();
  proboscis.position.set(0.25, -0.19, 0);
  head.add(proboscis);
  rod(proboscis, [0, 0, 0], [0.18, -0.14, 0], 0.052, 0.035, amber);
  for (const side of [-1, 1]) {
    ellipsoid(proboscis, [0.195, -0.15, side * 0.032], [0.069, 0.041, 0.043], dark);
    ellipsoid(head, [0.29, -0.18, side * 0.135], [0.085, 0.027, 0.025], honey);
  }
  const faceBristles: Bristle[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      faceBristles.push({ point: new THREE.Vector3(0.23 - i * 0.045, -0.18 - i * 0.01, side * 0.23), direction: new THREE.Vector3(0.4, -0.5, side * 0.75).normalize(), length: 0.1 - i * 0.007, radius: 0.004 });
    }
  }
  bristles(head, faceBristles);

  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const poses: Point[][] = [
      [[0.26, 0.11, side * 0.28], [0.60, -0.07, side * 0.55], [0.89, -0.40, side * 0.87], [1.20, -0.83, side * 0.83], [1.49, -0.92, side * 0.84]],
      [[-0.05, 0.04, side * 0.34], [-0.09, -0.19, side * 0.68], [0.10, -0.43, side * 1.01], [-0.11, -0.86, side * 1.26], [-0.36, -0.93, side * 1.35]],
      [[-0.39, 0.11, side * 0.28], [-0.75, -0.12, side * 0.59], [-0.99, -0.37, side * 0.86], [-1.39, -0.84, side * 1.15], [-1.77, -0.93, side * 1.20]],
    ];
    for (let index = 0; index < poses.length; index++) {
      const points = poses[index];
      const root = new THREE.Vector3(...points[0]);
      const leg = new THREE.Group();
      leg.position.copy(root);
      specimen.add(leg);
      legs.push(leg);
      const local = points.map((point) => new THREE.Vector3(...point).sub(root).toArray() as Point);
      const widths = [0.078, 0.052, 0.029, 0.016, 0.007];
      const hairs: Bristle[] = [];
      for (let segment = 0; segment < local.length - 1; segment++) {
        if (segment < 3) {
          rod(leg, local[segment], local[segment + 1], widths[segment], widths[segment + 1], segment === 2 ? amber : legMaterial);
        } else {
          // Five small tarsomeres rather than a single stick for each foot.
          const a = new THREE.Vector3(...local[segment]);
          const b = new THREE.Vector3(...local[segment + 1]);
          for (let tarsus = 0; tarsus < 5; tarsus++) {
            const p = a.clone().lerp(b, tarsus / 5);
            const q = a.clone().lerp(b, (tarsus + 0.89) / 5);
            rod(leg, p.toArray() as Point, q.toArray() as Point, 0.016 - tarsus * 0.0016, 0.011 - tarsus * 0.001, tarsus > 2 ? dark : legMaterial, 6);
          }
        }
        ellipsoid(leg, local[segment + 1], [widths[segment + 1] * 1.17, widths[segment + 1] * 1.17, widths[segment + 1] * 1.17], legMaterial);
        const a = new THREE.Vector3(...local[segment]);
        const b = new THREE.Vector3(...local[segment + 1]);
        for (let hair = 0; hair < (segment === 1 ? 18 : 10); hair++) {
          const t = 0.08 + random() * 0.84;
          const direction = new THREE.Vector3((random() - 0.5) * 0.6, 0.1 + random() * 0.3, side * (0.5 + random() * 0.4)).normalize();
          hairs.push({ point: a.clone().lerp(b, t).addScaledVector(direction, widths[segment] * (1 - t) + widths[segment + 1] * t), direction, length: 0.025 + random() * 0.053, radius: 0.0024 });
        }
      }
      const toe = local[local.length - 1];
      for (const claw of [-1, 1]) {
        curve(leg, [toe, [toe[0] + (index === 0 ? 0.043 : -0.043), toe[1] + 0.006, toe[2] + claw * 0.024], [toe[0] + (index === 0 ? 0.054 : -0.054), toe[1] - 0.016, toe[2] + claw * 0.027]], 0.0045, dark, 7);
      }
      bristles(leg, hairs);
    }
  }

  // One pair of flight wings, with costa, longitudinal veins, and cross-veins.
  const wingMaterial = new THREE.MeshPhysicalMaterial({ color: "#d6cbaa", roughness: 0.28, metalness: 0.04, transparent: true, opacity: 0.40, transmission: 0.12, thickness: 0.025, ior: 1.34, side: THREE.DoubleSide, depthWrite: false });
  const veinMaterial = new THREE.MeshStandardMaterial({ color: "#75694e", roughness: 0.58, transparent: true, opacity: 0.74 });
  const fineVeinMaterial = new THREE.MeshStandardMaterial({ color: "#968971", roughness: 0.65, transparent: true, opacity: 0.40 });
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0.02, 0);
  wingShape.bezierCurveTo(0.10, 0.15, -0.30, 0.41, -0.74, 0.58);
  wingShape.bezierCurveTo(-1.28, 0.78, -1.92, 0.81, -2.16, 0.52);
  wingShape.bezierCurveTo(-2.39, 0.20, -1.98, 0.04, -1.56, 0.005);
  wingShape.bezierCurveTo(-1.05, -0.04, -0.54, -0.105, 0.02, 0);
  const wingGeometry = new THREE.ShapeGeometry(wingShape, 40);
  wingGeometry.rotateX(Math.PI / 2);
  const veinPaths: Point[][] = [
    [[0.00, 0.003, 0.00], [-0.4, 0.003, 0.37], [-0.95, 0.003, 0.63], [-1.6, 0.003, 0.71], [-2.15, 0.003, 0.50]],
    [[-0.02, 0.008, 0.02], [-0.52, 0.008, 0.26], [-1.05, 0.008, 0.44], [-1.74, 0.008, 0.56], [-2.23, 0.008, 0.39]],
    [[-0.04, 0.009, 0.005], [-0.5, 0.009, 0.12], [-1.03, 0.009, 0.24], [-1.67, 0.009, 0.33], [-2.24, 0.009, 0.29]],
    [[-0.08, 0.009, 0.00], [-0.63, 0.009, 0.023], [-1.1, 0.009, 0.098], [-1.64, 0.009, 0.17], [-2.12, 0.009, 0.15]],
    [[-0.25, 0.009, -0.025], [-0.8, 0.009, -0.036], [-1.32, 0.009, 0.015], [-1.82, 0.009, 0.075]],
    [[-0.88, 0.010, 0.20], [-0.86, 0.010, 0.27], [-0.82, 0.010, 0.365]],
    [[-1.45, 0.010, 0.13], [-1.40, 0.010, 0.22], [-1.38, 0.010, 0.29]],
  ];
  const wings: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    // The halteres sit behind the wing hinges and are distinct from the wings.
    rod(specimen, [-0.46, 0.29, side * 0.37], [-0.68, 0.28, side * 0.65], 0.024, 0.016, pale);
    ellipsoid(specimen, [-0.705, 0.28, side * 0.681], [0.069, 0.055, 0.047], pale);
    const wing = new THREE.Group();
    wing.position.set(-0.24, 0.65, side * 0.32);
    wing.scale.z = side;
    wing.rotation.y = side * 0.08;
    wing.rotation.x = side * -0.065;
    const surface = new THREE.Mesh(wingGeometry, wingMaterial);
    surface.renderOrder = side === 1 ? 2 : 1;
    wing.add(surface);
    for (let i = 0; i < veinPaths.length; i++) {
      curve(wing, veinPaths[i], i === 0 ? 0.008 : i < 5 ? 0.005 : 0.0035, veinMaterial);
    }
    const perimeter = wingShape.getPoints(75).map((point) => [point.x, 0.004, point.y] as Point);
    curve(wing, perimeter, 0.003, fineVeinMaterial, 95);
    // Fine, sparse surface hairs catch the light without a large texture asset.
    const microHairs: Bristle[] = [];
    for (let i = 0; i < 170; i++) {
      const x = -0.15 - random() * 1.84;
      const width = 0.37 * Math.sin(((-x + 0.1) / 2.4) * Math.PI);
      const z = 0.035 + random() * width;
      microHairs.push({ point: new THREE.Vector3(x, 0.008, z), direction: new THREE.Vector3(-0.7, 0.5, 0.1).normalize(), length: 0.009 + random() * 0.007, radius: 0.001 });
    }
    bristles(wing, microHairs);
    specimen.add(wing);
    wings.push(wing);
  }

  // One physical connector follows the head. Its projected tip is the sole
  // cable attachment point; the parent draws the complete cable to its screen.
  const metalMaterial = new THREE.MeshPhysicalMaterial({ color: "#929b92", metalness: 0.72, roughness: 0.3 });
  const connectorMaterial = new THREE.MeshPhysicalMaterial({ color: "#c8e9c1", emissive: "#6caf75", emissiveIntensity: 0.35, roughness: 0.28, metalness: 0.15 });
  ellipsoid(head, [0.04, 0.307, -0.018], [0.050, 0.021, 0.046], metalMaterial);
  rod(head, [0.04, 0.318, -0.018], [0.04, 0.365, -0.018], 0.023, 0.019, metalMaterial, 12);
  const connector = ellipsoid(head, [0.04, 0.372, -0.018], [0.025, 0.012, 0.025], connectorMaterial);

  return { specimen, abdomen, head, wings, legs, antennae, proboscis, connector, connectorMaterial };
}

