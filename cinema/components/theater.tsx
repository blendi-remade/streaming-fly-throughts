'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ArrowUpRight, Check, Citrus, Clapperboard, Feather, Focus, Info, Leaf, LoaderCircle, Maximize2, Pause, Play, RotateCcw, Shuffle, Volume2, VolumeX, Wind, X } from 'lucide-react';

import dynamic from 'next/dynamic';

import { DreamStudy } from './dream-study';

import { SignalCable } from './signal-cable';

import { RoomDetails } from './room-details';

import { useBrain } from '@/lib/use-brain';

import { useDirector } from '@/lib/use-director';

import { useRecording } from '@/lib/use-recording';

import { useSceneEvidence } from '@/lib/use-scene-evidence';

import { populationRate, readBrain, READINGS } from '@/lib/readings';

import type { Drive, StimulusKind } from '@/lib/types';



const FlySpecimen = dynamic(() => import('./fly-specimen'), { ssr: false, loading: () => <div className="specimen-loading"><LoaderCircle className="spin" size={18} /></div> });

const STIMULI: { kind: StimulusKind; label: string; icon: typeof Citrus; drive: Drive; color: string }[] = [

  { kind: 'sugar', label: 'Sugar', icon: Citrus, drive: 'appetite', color: '#efb56b' },

  { kind: 'bitter', label: 'Bitter', icon: Leaf, drive: 'aversion', color: '#b79adb' },

  { kind: 'loom', label: 'Shadow', icon: Focus, drive: 'escape', color: '#ee8a83' },

  { kind: 'touch', label: 'Touch', icon: Feather, drive: 'groom', color: '#8cbfd3' },

  { kind: 'odor', label: 'Odor', icon: Wind, drive: 'explore', color: '#b0c983' },

];

const NAMES: Record<Drive, string> = { quiet: 'Rest', appetite: 'Appetite', aversion: 'Aversion', escape: 'Escape', groom: 'Grooming', explore: 'Exploration' };

const TOUR: StimulusKind[] = ['sugar', 'odor', 'loom', 'touch', 'bitter', 'sugar'];



export function Theater() {

  const brain = useBrain();

  const [sceneRevision, setSceneRevision] = useState(0);

  const scene = useSceneEvidence(brain.snapshot, brain.connected, sceneRevision);

  const sceneSnapshot = scene.snapshot || brain.snapshot;

  const director = useDirector();

  const [falConfigured, setFalConfigured] = useState(false);

  const [modal, setModal] = useState<'details' | 'setup' | null>(null);

  const [paused, setPaused] = useState(false);

  const [muted, setMuted] = useState(true);

  const [selected, setSelected] = useState<StimulusKind | null>(null);

  const [pending, setPending] = useState<StimulusKind | null>(null);

  const [rehearsal, setRehearsal] = useState<Drive>('quiet');

  const [tour, setTour] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);

  const video = useRef<HTMLVideoElement>(null), dialog = useRef<HTMLDivElement>(null);

  const stage = useRef<HTMLElement>(null), specimen = useRef<HTMLDivElement>(null), port = useRef<HTMLDivElement>(null);

  const anchor = useRef<{ x: number; y: number } | null>(null);

  const request = useRef(0);

  const current = useRef(sceneSnapshot); current.current = sceneSnapshot;

  const status = useRef(director.status); status.current = director.status;

  const rawReading = readBrain(brain.snapshot);

  const reading = brain.connected ? readBrain(sceneSnapshot) : { ...READINGS[rehearsal], strength: 0, evidence: 'Visual study only. The brain is offline.' };

  const live = director.status === 'live', connecting = director.status === 'connecting';

  const recording = useRecording(brain.snapshot, live);

  const activity = brain.connected ? rawReading.strength : 0;

  const observedInput = brain.connected && brain.snapshot.stimulus.remainingMs > 0 ? STIMULI.find(s => s.kind === brain.snapshot.stimulus.kind) : undefined;

  const input = STIMULI.find(s => s.kind === pending) || observedInput || STIMULI.find(s => s.kind === selected);

  const inputState = pending ? 'Applying' : observedInput ? 'Stimulus' : !brain.connected && input ? 'Preview' : input ? 'Last selected' : 'Input';

  const maximum = Math.max(500, ...brain.history);

  const points = brain.history.map((v, i) => `${i * 3.6},${31 - v / maximum * 27}`).join(' ');

  const reportAnchor = useCallback((point: { x: number; y: number }) => { anchor.current = point; }, []);

  useEffect(() => {

    let alive = true;

    const refresh = () => void fetch('/api/config', { signal: AbortSignal.timeout(4000) }).then(r => r.json()).then(d => { if (alive) setFalConfigured(d.falConfigured === true); }).catch(() => { if (alive) setFalConfigured(false); });

    refresh(); const timer = setInterval(refresh, 10000);

    return () => { alive = false; clearInterval(timer); };

  }, []);

  useEffect(() => {

    if (!video.current) return;

    video.current.srcObject = director.stream;

    if (director.stream) void video.current.play().catch(() => setNotice('Tap the sound control to begin playback.'));

  }, [director.stream]);

  useEffect(() => { if (brain.connected && (live || connecting)) void director.steer(sceneSnapshot); }, [brain.connected, sceneSnapshot, live, connecting, director.steer]);

  useEffect(() => { if (!brain.connected && (live || connecting)) { void director.stop(); setNotice('Brain disconnected. Cinema stopped.'); } }, [brain.connected, live, connecting, director.stop]);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 4500); return () => clearTimeout(timer); }, [notice]);

  useEffect(() => {

    if (!modal) return;

    const previous = document.activeElement as HTMLElement | null;

    const items = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select') || []);

    items()[0]?.focus();

    const trap = (event: KeyboardEvent) => {

      if (event.key === 'Escape') setModal(null);

      if (event.key !== 'Tab') return;

      const elements = items(), first = elements[0], last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }

      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }

    };

    document.addEventListener('keydown', trap);

    return () => { document.removeEventListener('keydown', trap); previous?.focus(); };

  }, [modal]);

  const apply = useCallback(async (kind: StimulusKind) => {

    const id = ++request.current;

    setPending(kind); setSelected(kind === 'clear' ? null : kind);

    try {

      if (brain.connected) {

        const result = await brain.stimulate(kind);

        if (id !== request.current) return;

        setSceneRevision(v => v + 1);

        if (status.current === 'live' || status.current === 'connecting') void director.steer(result.snapshot);

      } else { setRehearsal(STIMULI.find(s => s.kind === kind)?.drive || 'quiet'); setNotice('Visual study only. The brain is offline.'); }

    } catch (cause) { if (id === request.current) setNotice(cause instanceof Error ? cause.message : 'Stimulus failed.'); }

    finally { if (id === request.current) setPending(null); }

  }, [brain.connected, brain.stimulate, director.steer]);

  useEffect(() => {

    if (!tour) return;

    let index = 0; void apply(TOUR[index++]);

    const timer = setInterval(() => { void apply(TOUR[index++ % TOUR.length]); }, 15000);

    return () => clearInterval(timer);

  }, [tour, apply]);

  useEffect(() => {

    const key = (event: KeyboardEvent) => {

      if (modal || event.repeat || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)) return;

      const stimulus = STIMULI[Number(event.key) - 1];

      if (stimulus) { event.preventDefault(); setTour(false); void apply(stimulus.kind); }

    };

    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);

  }, [apply, modal]);

  const startFilm = async () => {

    if (live || connecting) { await director.stop(); return; }

    if (!falConfigured || !brain.connected) { setModal('setup'); return; }

    await director.start(current.current);

  };

  const fullscreen = async () => {

    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }

    catch { setNotice('Fullscreen is unavailable in this browser panel.'); }

  };

  const reset = async () => {

    setTour(false); setSelected(null);

    if (live || connecting) await director.stop();

    try {

      const response = await fetch('/api/brain', { method: 'POST', signal: AbortSignal.timeout(4000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'reset' }) });

      if (!response.ok) throw new Error('Could not reset the brain.');

      setSceneRevision(v => v + 1); setNotice('Fresh neural state.');

    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Reset failed.'); }

  };



  return <main className="exhibit" style={{ '--drive-color': reading.color } as React.CSSProperties}>

    <header className="topbar">

      <h1><FlyMark /><span>FLY<span className="brand-divider">/</span>THOUGHTS</span></h1>

      <div className="topbar-actions"><span className="brain-status"><i className={brain.connected ? 'online' : ''} />{brain.connected ? 'Brain connected' : 'Brain offline'}</span><button className="details-button" onClick={() => setModal('details')}><Info size={14} /><span>More details</span></button><button className="icon-button fullscreen-button" onClick={() => void fullscreen()} aria-label="Fullscreen"><Maximize2 size={16} /></button></div>

    </header>

    <section className="showcase" ref={stage} aria-label="Fly brain connected to its cinema">

      <div className="room-light" /><div className="floor-grid" /><RoomDetails />

      <div className="stage-coordinate">DROSOPHILA MELANOGASTER <span>001</span></div>

      <div className="specimen-view" data-specimen ref={specimen}><FlySpecimen activity={activity} drive={brain.connected ? rawReading.drive : reading.drive} onAnchor={reportAnchor} /></div>

      <div className="tv-assembly">

        <div className="tv-label"><span><i className={live ? 'on-air' : ''} />{live ? 'LIVE CINEMA' : connecting ? 'CONNECTING' : 'VISUAL STUDY'}</span><span className="stimulus-indicator" data-stimulus-indicator role="status" style={{ '--input-color': input?.color || '#73948c' } as React.CSSProperties}><i />{inputState} · {pending === 'clear' ? 'Clear' : input?.label || 'None'}</span></div>

        <div className="tv-frame">

          <div className="tv-port" ref={port} aria-label="Neural input port"><span /></div>

          <div className="screen-content">

            <DreamStudy drive={reading.drive} activity={activity} paused={paused || live} />

            <video data-cinema-video ref={video} autoPlay playsInline muted={muted} aria-label="Live generated cinema" className={`director-video ${live && director.stream ? 'visible' : ''}`} />

            <div className="screen-shade" />

            {connecting && <div className="connecting-veil"><LoaderCircle className="spin" size={23} /><span>Opening the cinema</span><small>The first frames are being generated.</small></div>}

          </div>

          <div className="tv-chin"><div className="tv-maker"><span className={live ? 'power-light active' : 'power-light'} />NEURAL DISPLAY<span className="model-number">01</span></div><div className="tv-actions">{live && <span className="session-clock">{formatTime(director.elapsed)}</span>}<button className="screen-icon" onClick={() => live ? setMuted(!muted) : setPaused(!paused)} aria-label={live ? muted ? 'Unmute film' : 'Mute film' : paused ? 'Play preview' : 'Pause preview'}>{live ? muted ? <VolumeX size={15} /> : <Volume2 size={15} /> : paused ? <Play size={14} /> : <Pause size={14} />}</button></div></div>

        </div><div className="tv-stand" /><div className="tv-foot" /><div className="tv-reflection" />

      </div>

      <SignalCable stage={stage} specimen={specimen} port={port} anchor={anchor} activity={activity} />

      <button className="neural-hud" onClick={() => setModal('details')} aria-label="Inspect measured neural activity"><div className="hud-heading"><i className={brain.connected ? 'online' : ''} /><span>NEURAL ACTIVITY</span><ArrowUpRight size={11} /></div><div className="hud-readout"><strong>{brain.connected ? brain.snapshot.totalSpikes.toLocaleString() : '—'}</strong><span>spikes / 50 ms</span></div><svg viewBox="0 0 227 36" preserveAspectRatio="none" aria-label="Recent measured spikes"><path d="M0 35H227" stroke="#263537" /><polyline points={points} fill="none" stroke="#73c4b1" strokeWidth="1.2" vectorEffect="non-scaling-stroke" /></svg><div className="hud-foot">176,422 nodes<span>{brain.connected ? `${brain.snapshot.realTimeFactor.toFixed(2)}×` : 'OFFLINE'}</span></div></button>

      <span className="stage-note">Simulated brain. Artistic interpretation.</span>

    </section>

    <div className="control-dock">

      <div className="stimulus-group" aria-label="Give the fly a stimulus">{STIMULI.map((s, index) => {

        const active = brain.connected ? brain.snapshot.stimulus.kind === s.kind && brain.snapshot.stimulus.remainingMs > 0 : selected === s.kind;

        return <button key={s.kind} className={`stimulus ${active ? 'active' : ''} ${pending === s.kind ? 'pending' : ''}`} style={{ '--stimulus-color': s.color } as React.CSSProperties} onClick={() => { setTour(false); void apply(s.kind); }} aria-pressed={active} title={`${s.label} · press ${index + 1}`}>{pending === s.kind ? <LoaderCircle size={19} className="spin" /> : <s.icon size={19} strokeWidth={1.5} />}<span>{s.label}</span><kbd>{index + 1}</kbd></button>;

      })}</div>

      <div className="dock-actions"><button className={`icon-button auto-button ${tour ? 'active' : ''}`} onClick={() => setTour(!tour)} aria-label={tour ? 'Stop automatic stimuli' : 'Automatic stimuli'} aria-pressed={tour} title="Automatic stimuli"><Shuffle size={17} /></button><button className="icon-button" onClick={() => { setTour(false); void apply('clear'); }} aria-label="Clear stimulus" title="Clear stimulus"><RotateCcw size={16} /></button><span className="dock-divider" /><button className={`capture-button ${recording.seconds !== null ? 'recording' : ''}`} onClick={recording.start} aria-label={recording.seconds !== null ? 'Stop and save recording' : 'Record 30 seconds'} title="Record 30 seconds">{recording.seconds !== null ? <><i className="record-dot" /><span>{30 - recording.seconds}s</span></> : <Clapperboard size={18} />}</button><button className={`stream-button ${live ? 'streaming' : ''}`} onClick={() => void startFilm()} disabled={director.status === 'stopping'}>{connecting ? <><LoaderCircle className="spin" size={15} />Cancel</> : live ? <><span className="stop-square" />Stop cinema</> : <><Play size={14} fill="currentColor" />Start cinema</>}</button></div>

    </div>

    {(director.error || recording.error) && <div className="inline-error" role="alert">{director.error || recording.error}</div>}

    {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} /></button></div>}

    {modal && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className="details-panel" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="details-title">

      <div className="panel-top"><span>{modal === 'details' ? 'THE EXPERIMENT' : 'CONNECTIONS'}</span><button className="icon-button" onClick={() => setModal(null)} aria-label="Close details"><X size={19} /></button></div>

      <h2 id="details-title">{modal === 'details' ? 'Behind the signal' : 'Connect the cinema'}</h2>

      {modal === 'details' ? <>

        <p>A full connectome simulation drives the imagery. The fly’s wiring is real data; its activity is simulated; the film is an artistic interpretation.</p>

        <div className="pipeline"><span>Brain</span><ArrowUpRight size={14} /><span>Direction</span><ArrowUpRight size={14} /><span>H3 Director</span></div>

        <div className="detail-section"><h3>Right now <span>{NAMES[reading.drive]}</span></h3><p>{reading.evidence || 'Waiting for the brain.'}</p><small>Scene sample: {(scene.evidenceAgeMs / 1000).toFixed(1)}s ago. Brief responses can hold a scene for up to 3 seconds; measurements below stay live.</small><div className="population-list">{[['Feeding · MN9', 'MN9'], ['Escape · DNp01', 'DNp01'], ['Grooming · aDN1', 'aDN1'], ['Odor · ORN_DM1', 'ORN_DM1']].map(([label, name]) => <div key={name}><span>{label}</span><strong>{brain.connected ? populationRate(brain.snapshot, name).toFixed(1) : '—'} <small>Hz</small></strong></div>)}</div></div>

        <div className="detail-section"><h3>Direction speed</h3><div className="mode-options"><button aria-pressed={director.translatorMode === 'direct'} onClick={() => director.setTranslatorMode('direct')}><strong>Direct</strong><span>Fastest response</span></button><button aria-pressed={director.translatorMode === 'llm'} onClick={() => director.setTranslatorMode('llm')}><strong>LLM assisted</strong><span>More variety between changes</span></button></div><p>Measured changes go straight to Director. H3 prepares chunks ahead of playback, so a new direction affects the next available generation. Buffered frames keep playing.</p>{live && <><div className="latency-readout"><span>Observed → sent</span><strong>{latency(director.latency.observedToSentMs)}</strong><span>Sent → accepted</span><strong>{latency(director.latency.sentToAcceptedMs)}</strong><span>Sent → generated</span><strong>{latency(director.latency.sentToGeneratedMs)}</strong></div><small>Accepted v{director.appliedVersion} · generated v{director.visibleVersion} · {director.bufferSeconds.toFixed(1)}s buffered. These events do not identify the exact displayed frame.</small></>}</div>

        <div className="detail-section"><h3>The model</h3><p>176,422 imported nodes · 6,287,749 connections. MaleCNS v1.0 marks 165,122 nodes as traced. Simplified spiking neurons and the original sensory encoders run locally, including analytical looming input. This does not decode thoughts or consciousness.</p><p>At startup, all neurons begin at −52 mV with empty spike queues, zero synaptic current and a fixed random seed (20260903). Ambient light (0.6) drives the visual system; the network advances in 0.5 ms steps. Button presses add sensory input to this ongoing activity.</p><p>The connectome supplies wiring, not a saved mental state or memories. The mapping from measured activity to cinematic imagery is authored, not a validated thought decoder. Idle movement is animation; neural readouts modulate it.</p><p>Clear removes the stimulus while activity continues. Reset rebuilds neural and sensory adaptation state with the same seed, and stops the cinema.</p><button className="secondary-button" onClick={() => void reset()} disabled={!brain.connected}><RotateCcw size={14} />Reset neural state</button></div>

        <div className="detail-section"><h3>Recording & sessions</h3><p>Record exports up to 30 seconds as WebM. A live screening stops after 3 minutes. fal bills generated video, including queued output, and applies a minimum charge.</p><div className="detail-links"><a href="https://fal.ai/models/minimax/h3-max/director" target="_blank" rel="noreferrer">Director pricing <ArrowUpRight size={12} /></a><a href="https://male-cns.janelia.org/" target="_blank" rel="noreferrer">Open connectome <ArrowUpRight size={12} /></a></div><small>MaleCNS: FlyEM / Janelia, Cambridge, MRC LMB & Google Research · CC BY 4.0. Fly anatomy is a procedural artistic model.</small></div>

      </> : <><div className="connection-row"><span><i className={brain.connected ? 'online' : ''} />Brain simulation</span>{brain.connected ? <Check size={16} /> : <code>npm run brain</code>}</div><div className="connection-row"><span><i className={falConfigured ? 'online' : ''} />fal</span>{falConfigured ? <Check size={16} /> : <span>Key required</span>}</div>{!falConfigured && <p>Set <code>FAL_KEY</code> in <code>cinema/.env.local</code> and restart the app. The key stays on the server.</p>}<p>A screening runs for up to 3 minutes. Video generation is billed by fal.</p><button className="stream-button wide" disabled={!brain.connected || !falConfigured} onClick={() => { setModal(null); void director.start(current.current); }}><Play size={14} fill="currentColor" />Start cinema</button></>}

    </div></div>}

  </main>;

}

function formatTime(seconds: number) { const n = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }

function latency(ms: number | null | undefined) { return ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`; }

function FlyMark() { return <svg width="23" height="23" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 11C12 5 5 4 5 10c0 5 8 8 11 7M16 11c4-6 11-7 11-1 0 5-8 8-11 7" stroke="currentColor" strokeWidth="1.25" /><ellipse cx="16" cy="19" rx="2.5" ry="7" fill="currentColor" /><circle cx="16" cy="10" r="3" fill="currentColor" /><path d="m14 17-5 4-2 5m11-9 5 4 2 5m-12-6-3 7m9-7 3 7M14 8l-3-4m7 4 3-4" stroke="currentColor" strokeWidth="1.2" /></svg>; }



