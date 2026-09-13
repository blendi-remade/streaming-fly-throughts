import * as THREE from 'three';

/** A static, layered skyline behind the room's actual window opening. */
export function makeNightCity() {
  const city = new THREE.Group();
  city.name = 'night-city';
  let seed = 1977;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(160, 80), new THREE.ShaderMaterial({
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec2 vUv;
      void main(){
        vec3 horizon=vec3(0.008,0.019,0.030);
        vec3 night=vec3(0.001,0.003,0.009);
        float h=smoothstep(0.35,0.8,vUv.y);
        gl_FragColor=vec4(mix(horizon,night,h),1.0);
      }`,
  }));
  sky.position.set(0, 12, -55); city.add(sky);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const lights: { position: THREE.Vector3; color: THREE.Color }[] = [];
  const colors = ['#d2aa73', '#88b2bf', '#ead1a2'];
  for (let layer = 0; layer < 3; layer++) {
    const z = -38 + layer * 9;
    const material = new THREE.MeshBasicMaterial({ color: ['#213846', '#142833', '#0b1b24'][layer] });
    for (let x = -48; x < 48;) {
      const width = 1.2 + random() * 2.6;
      const height = 3 + random() * 9;
      const base = -5;
      const building = new THREE.Mesh(geometry, material);
      building.position.set(x + width / 2, base + height / 2, z);
      building.scale.set(width, height, 1.5); city.add(building);
      if (height > 9) {
        const aerial = new THREE.Mesh(geometry, material);
        aerial.position.set(x + width / 2, base + height + 0.6, z);
        aerial.scale.set(0.055, 1.2, 0.055); city.add(aerial);
      }
      for (let wx = 0.22; wx < width - 0.15; wx += 0.34) {
        for (let wy = 0.3; wy < height - 0.2; wy += 0.48) {
          if (random() < 0.48) continue;
          lights.push({ position: new THREE.Vector3(x + wx, base + wy, z + 0.76), color: new THREE.Color(colors[Math.floor(random() * colors.length)]).multiplyScalar(0.45 + random() * 0.8) });
        }
      }
      x += width + 0.3 + random() * 0.8;
    }
  }
  const windows = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.22), new THREE.MeshBasicMaterial({ color: '#ffffff' }), lights.length);
  const matrix = new THREE.Matrix4();
  lights.forEach((light, i) => { windows.setMatrixAt(i, matrix.makeTranslation(light.position)); windows.setColorAt(i, light.color); });
  city.add(windows);
  return city;
}
