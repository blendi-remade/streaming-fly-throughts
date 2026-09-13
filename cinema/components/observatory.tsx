'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createObservatory, type ViewName } from '@/lib/scene/observatory';
import type { BrainSnapshot, Drive, StimulusKind } from '@/lib/types';

export type SceneView = { name: ViewName; revision: number };
type Props = {
  snapshot: BrainSnapshot;
  activity: number;
  drive: Drive;
  rawDrive: Drive;
  input: string | null;
  paused: boolean;
  live: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  view: SceneView;
  onView: (name: ViewName) => void;
  onStimulus: (kind: StimulusKind) => void;
};

export default function Observatory(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  current.current = props;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setError(null); setReady(false);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    } catch {
      setError('The observatory needs WebGL. Try enabling hardware acceleration in your browser.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const canvas = renderer.domElement;
    canvas.dataset.observatoryCanvas = '';
    canvas.setAttribute('aria-label', 'Interactive 3D observatory. Drag to orbit, scroll or pinch to zoom. Use the view buttons to inspect the fly and cinema.');
    canvas.setAttribute('role', 'img');
    canvas.style.touchAction = 'none';
    element.appendChild(canvas);

    const world = createObservatory();
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(environment, 0.04);
    world.scene.environment = envTarget.texture;
    world.scene.environmentIntensity = 0.32;
    environment.dispose(); pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.065;
    controls.enablePan = true; controls.panSpeed = 0.7;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.rotateSpeed = 0.50; controls.zoomSpeed = 0.7;
    controls.minDistance = 4.5; controls.maxDistance = 48;
    controls.minPolarAngle = Math.PI * 0.12; controls.maxPolarAngle = Math.PI * 0.485;
    controls.minAzimuthAngle = -Math.PI * 0.46; controls.maxAzimuthAngle = Math.PI * 0.46;
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(world.scene, camera);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.45, 1.1);
    const output = new OutputPass();
    composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(output);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let targetPosition = new THREE.Vector3(), targetLook = new THREE.Vector3();
    let moving = false, lastView = '', lastWidth = 0;
    function focus(name: ViewName, immediate = false) {
      const aspect = camera.aspect;
      const fit = Math.max(1, 1.48 / aspect);
      const look = name === 'specimen' ? new THREE.Vector3(-3.55, 1.65, 0.35)
        : name === 'cinema' ? new THREE.Vector3(2.95, 2.90, -0.2) : new THREE.Vector3(-0.1, 1.35, 0);
      const offset = name === 'specimen' ? new THREE.Vector3(4.1, 2.3, 6.1)
        : name === 'cinema' ? new THREE.Vector3(0.65, 0.8, 8.5) : new THREE.Vector3(7.9, 6.6, 16.8);
      offset.multiplyScalar(name === 'room' ? Math.min(fit, 2.15) : Math.min(fit, 1.9));
      targetPosition = look.clone().add(offset); targetLook = look;
      moving = true;
      if (immediate || reducedMotion.matches) {
        camera.position.copy(targetPosition); controls.target.copy(targetLook); controls.update(); moving = false;
      }
      canvas.dataset.view = name;
    }
    const resize = () => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height; camera.updateProjectionMatrix();
      renderer.setSize(width, height); composer.setSize(width, height);
      if (Math.abs(width - lastWidth) > 80 || lastWidth === 0) focus(current.current.view.name, lastWidth === 0);
      lastWidth = width;
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let hovered: THREE.Object3D | null = null, down: { x: number; y: number } | null = null;
    let dragging = false;
    const pointers = new Set<number>();
    let multiTouch = false;
    function hit(event: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(world.pickables, false)[0]?.object ?? null;
    }
    const pointerMove = (event: PointerEvent) => {
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) dragging = true;
      const next = dragging ? null : hit(event);
      if (hovered !== next) { hovered = next; setHover(next?.userData.title || ''); }
      canvas.style.cursor = dragging ? 'grabbing' : next ? 'pointer' : 'grab';
    };
    const pointerDown = (event: PointerEvent) => {
      pointers.add(event.pointerId);
      if (pointers.size > 1) { multiTouch = true; dragging = true; return; }
      down = { x: event.clientX, y: event.clientY }; dragging = false; multiTouch = false;
    };
    const pointerUp = (event: PointerEvent) => {
      if (down && !dragging && !multiTouch && event.button === 0 && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 5) {
        const action = hit(event)?.userData.action;
        if (action?.kind === 'view') current.current.onView(action.view);
        if (action?.kind === 'stimulus') current.current.onStimulus(action.stimulus);
      }
      pointers.delete(event.pointerId);
      down = null; dragging = false; canvas.style.cursor = hovered ? 'pointer' : 'grab';
    };
    const pointerLeave = () => { hovered = null; down = null; dragging = false; pointers.clear(); setHover(''); };
    const beginOrbit = () => { moving = false; };
    controls.addEventListener('start', beginOrbit);
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerLeave);
    canvas.addEventListener('pointerleave', pointerLeave);

    let videoTexture: THREE.VideoTexture | null = null;
    let videoMaterial: THREE.MeshBasicMaterial | null = null;
    let frame = 0, lastTime = performance.now(), lastRender = 0, time = 0, disposed = false;
    const draw = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(draw);
      if (document.hidden) { lastTime = now; return; }
      // Cap at 40 fps to leave CPU headroom for the local connectome.
      if (now - lastRender < 25) return;
      lastRender = now;
      const dt = Math.min(0.075, Math.max(0, (now - lastTime) / 1000)); lastTime = now; time += dt;
      const p = current.current;
      const viewKey = p.view.name + ':' + p.view.revision;
      if (viewKey !== lastView) { if (lastView) focus(p.view.name); lastView = viewKey; }
      if (moving) {
        const a = 1 - Math.exp(-dt * 4);
        camera.position.lerp(targetPosition, a); controls.target.lerp(targetLook, a);
        if (camera.position.distanceTo(targetPosition) < 0.005) moving = false;
      }
      controls.update();
      const video = p.videoRef.current;
      if (video && !videoTexture) {
        videoTexture = new THREE.VideoTexture(video); videoTexture.colorSpace = THREE.SRGBColorSpace;
        videoMaterial = new THREE.MeshBasicMaterial({ map: videoTexture, toneMapped: false });
      }
      const hasVideo = p.live && video && video.readyState >= 2 && video.videoWidth > 0 && videoMaterial;
      world.screen.material = hasVideo ? videoMaterial! : world.dream;
      canvas.dataset.media = hasVideo ? 'live' : 'study';
      world.update(time, dt, p.activity, p.drive, p.rawDrive, p.snapshot, p.input, reducedMotion.matches, p.paused || !!hasVideo, hovered);
      composer.render();
    };
    const contextLost = (event: Event) => {
      event.preventDefault(); cancelAnimationFrame(frame);
      setError('The 3D connection was interrupted. Reopen the observatory to continue.');
    };
    canvas.addEventListener('webglcontextlost', contextLost);
    frame = requestAnimationFrame(draw); setReady(true);
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerLeave);
      canvas.removeEventListener('pointerleave', pointerLeave); controls.removeEventListener('start', beginOrbit);
      controls.dispose(); bloom.dispose(); output.dispose(); composer.dispose();
      world.dispose(); videoTexture?.dispose(); videoMaterial?.dispose(); envTarget.dispose(); renderer.dispose(); canvas.remove();
    };
  }, [attempt]);

  return <div className="observatory" ref={host} data-scene-ready={ready && !error}>
    {!ready && !error && <div className="scene-loading"><span className="loading-orbit" /><p>Preparing a little universe</p></div>}
    {error && <div className="scene-fallback" role="alert"><p>{error}</p><button onClick={() => setAttempt(v => v + 1)}>Reopen observatory</button></div>}
    {hover && !error && <div className="object-hint" aria-live="polite"><span />{hover}</div>}
  </div>;
}
