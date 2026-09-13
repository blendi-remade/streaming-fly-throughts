'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrainSnapshot } from './types';
type RecordingSession = { stop: () => void; dispose: () => void };

/** Record the same rendered scene, including the current camera and the screen's video texture. */
function drawShowcase(ctx: CanvasRenderingContext2D, snapshot: BrainSnapshot, live: boolean) {
  const scene = document.querySelector<HTMLCanvasElement>('[data-observatory-canvas]');
  if (!scene?.width || !scene.height || scene.parentElement?.dataset.sceneReady !== 'true') {
    throw new Error('The 3D observatory is not ready to record yet.');
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#091214'; ctx.fillRect(0, 0, 1600, 900);
  const fit = Math.min(1600 / scene.width, 750 / scene.height);
  const width = scene.width * fit, height = scene.height * fit;
  ctx.drawImage(scene, (1600 - width) / 2, 76 + (750 - height) / 2, width, height);
  ctx.fillStyle = '#e3e6d8'; ctx.font = '500 21px "DM Sans Variable", sans-serif';
  ctx.fillText('FLY / THOUGHTS', 44, 45);
  ctx.textAlign = 'right'; ctx.font = '12px monospace'; ctx.fillStyle = '#b4c2a3';
  ctx.fillText(scene.dataset.media === 'live' ? 'H3 DIRECTOR · LIVE CINEMA' : live ? 'H3 · WAITING FOR VIDEO' : 'THE NEURAL OBSERVATORY · VISUAL STUDY', 1556, 45);
  ctx.textAlign = 'left'; ctx.fillStyle = '#77917c'; ctx.fillRect(44, 830, 1512, 1);
  ctx.font = '12px monospace'; ctx.fillStyle = '#bdc9ac';
  const input = document.querySelector('[data-stimulus-indicator]')?.textContent || 'Input · None';
  ctx.fillText(input.toUpperCase(), 44, 861, 390);
  ctx.fillStyle = '#8fa086'; ctx.font = '11px monospace';
  ctx.fillText(snapshot.source === 'connectome' ? snapshot.totalSpikes.toLocaleString() + ' SPIKES / 50 ms · SIMULATED CONNECTOME' : 'BRAIN OFFLINE · ARTISTIC PREVIEW', 430, 861);
  ctx.textAlign = 'right';
  ctx.fillText('NEURAL ACTIVITY → ARTISTIC INTERPRETATION', 1556, 861);
  ctx.textAlign = 'left';
}

export function useRecording(snapshot: BrainSnapshot, live: boolean) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<RecordingSession | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ snapshot, live });
  latest.current = { snapshot, live };
  const stop = useCallback(() => active.current?.stop(), []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.dispose(); };
  }, []);
  const start = useCallback(() => {
    if (!mounted.current) return;
    if (active.current) { stop(); return; }
    if (typeof MediaRecorder === 'undefined') { setError('Recording is not supported by this browser. Try Chrome or Edge.'); return; }
    setError(null);
    let stream: MediaStream | undefined;
    let recorder: MediaRecorder | undefined;
    let session: RecordingSession | undefined;
    let frame = 0;
    let finished = false;
    let stopping = false;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    const chunks: Blob[] = [];
    const release = () => {
      if (finished) return false;
      finished = true;
      clearTimeout(stopTimer); clearTimeout(finishTimer); cancelAnimationFrame(frame);
      if (recorder) { recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null; }
      stream?.getTracks().forEach(track => track.stop());
      if (active.current === session) active.current = null;
      if (mounted.current) setSeconds(null);
      return true;
    };
    const dispose = () => {
      if (!release()) return;
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Tracks are already released. */ } }
    };
    const fail = (message: string) => { if (mounted.current) setError(message); dispose(); };
    const finish = () => {
      if (!release() || !mounted.current) return;
      if (!chunks.length) { setError('The recording contained no frames. Please try again.'); return; }
      try {
        const type = recorder?.mimeType || chunks[0].type || 'video/webm';
        const url = URL.createObjectURL(new Blob(chunks, { type }));
        const a = document.createElement('a'); a.href = url;
        a.download = `fly-thoughts-${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
        setTimeout(() => URL.revokeObjectURL(url), 10000); a.click();
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the recording.'); }
    };
    const requestStop = () => {
      if (finished || stopping || !recorder) return;
      stopping = true;
      clearTimeout(stopTimer); cancelAnimationFrame(frame);
      try {
        if (recorder.state === 'inactive') { finish(); return; }
        recorder.stop();
        if (!finished) finishTimer = setTimeout(() => fail('The browser could not finish the recording. Please try again.'), 3000);
      } catch (cause) { fail(cause instanceof Error ? cause.message : 'Could not finish recording.'); }
    };
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Could not create recording canvas.');
      stream = canvas.captureStream(24);
      const video = document.querySelector<HTMLVideoElement>('[data-cinema-video]');
      if (latest.current.live && video?.srcObject instanceof MediaStream) for (const t of video.srcObject.getAudioTracks()) stream.addTrack(t.clone());
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
      recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 7_000_000 });
      recorder.ondataavailable = e => { if (!finished && e.data.size) chunks.push(e.data); };
      recorder.onstop = finish;
      recorder.onerror = () => fail('The recording could not be completed.');
      session = { stop: requestStop, dispose };
      active.current = session;
      const started = performance.now(); let last = 0;
      const draw = (now: number) => {
        if (finished || active.current !== session) return;
        frame = requestAnimationFrame(draw);
        if (now - last < 40) return; last = now;
        try {
        const { snapshot: s, live: isLive } = latest.current;
        drawShowcase(ctx, s, isLive);
        const elapsed = Math.floor((now - started) / 1000); setSeconds(elapsed);
        if (elapsed >= 15) requestStop();
        } catch (cause) { fail(cause instanceof Error ? cause.message : 'Could not capture the cinema frame.'); }
      };
      recorder.start(1000);
      if (finished) return;
      setSeconds(0); frame = requestAnimationFrame(draw);
      // RAF pauses in background tabs; recording duration must not depend on drawing another frame.
      stopTimer = setTimeout(requestStop, 15000);
    } catch (cause) { fail(cause instanceof Error ? cause.message : 'Could not begin recording.'); }
  }, [stop]);
  return { seconds, error, start, stop };
}
