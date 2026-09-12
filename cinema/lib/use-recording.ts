'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrainSnapshot } from './types';
type RecordingSession = { stop: () => void; dispose: () => void };

function drawShowcase(ctx: CanvasRenderingContext2D, snapshot: BrainSnapshot, live: boolean) {
  const stage = document.querySelector<HTMLElement>('.showcase');
  const stageBox = stage?.getBoundingClientRect();
  if (!stage || !stageBox?.width || !stageBox.height) throw new Error('The showcase is not ready to record yet.');

  const specimen = stage.querySelector<HTMLCanvasElement>('[data-specimen] canvas');
  const tv = stage.querySelector<HTMLElement>('.tv-frame');
  const screen = stage.querySelector<HTMLElement>('.screen-content');
  const port = stage.querySelector<HTMLElement>('.tv-port');
  const cable = stage.querySelector<SVGSVGElement>('.signal-cable');
  const video = stage.querySelector<HTMLVideoElement>('[data-cinema-video]');
  const hasLiveFrame = !!(live && video && video.readyState >= 2 && video.videoWidth && video.videoHeight);
  const screenBox = screen?.getBoundingClientRect();
  const tvBox = tv?.getBoundingClientRect();

  // One uniform stage transform preserves the current layout and the fly's proportions, including mobile.
  // SVG getScreenCTM() uses these same viewport coordinates, so both wire endpoints stay on their DOM anchors.
  const scale = Math.min(1520 / stageBox.width, 680 / stageBox.height);
  const offsetX = 40 + (1520 - stageBox.width * scale) / 2;
  const offsetY = 100 + (680 - stageBox.height * scale) / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#020607'; ctx.fillRect(0, 0, 1600, 900);
  const room = ctx.createRadialGradient(780, 415, 60, 780, 470, 940);
  room.addColorStop(0, '#112327'); room.addColorStop(0.52, '#071013'); room.addColorStop(1, '#020607');
  ctx.fillStyle = room; ctx.fillRect(0, 90, 1600, 700);

  ctx.save();
  ctx.translate(offsetX - stageBox.left * scale, offsetY - stageBox.top * scale); ctx.scale(scale, scale);
  ctx.beginPath(); ctx.rect(stageBox.left, stageBox.top, stageBox.width, stageBox.height); ctx.clip();
  const floor = ctx.createLinearGradient(0, stageBox.top + stageBox.height * 0.7, 0, stageBox.bottom);
  floor.addColorStop(0, 'rgba(31,61,63,0)'); floor.addColorStop(1, 'rgba(24,43,46,.32)');
  ctx.fillStyle = floor; ctx.fillRect(stageBox.left, stageBox.top, stageBox.width, stageBox.height);

  const set = stage.querySelector<HTMLCanvasElement>('[data-room]');
  if (set?.width && set.height) ctx.drawImage(set, stageBox.left, stageBox.top, stageBox.width, stageBox.height);

  if (tv && tvBox?.width && tvBox.height) {
    const center = tvBox.left + tvBox.width / 2;
    const stemWidth = Math.max(18, tvBox.width * 0.035);
    const stemHeight = Math.min(38, tvBox.height * 0.08);
    ctx.fillStyle = '#182326';
    ctx.fillRect(center - stemWidth / 2, tvBox.bottom - 1, stemWidth, stemHeight);
    ctx.beginPath(); ctx.roundRect(center - tvBox.width * 0.14, tvBox.bottom + stemHeight - 3, tvBox.width * 0.28, 7, 3); ctx.fill();
    const metal = ctx.createLinearGradient(tvBox.left, tvBox.top, tvBox.right, tvBox.bottom);
    metal.addColorStop(0, '#607072'); metal.addColorStop(0.07, '#263336');
    metal.addColorStop(0.6, '#0e171a'); metal.addColorStop(1, '#47575a');
    const radius = Number.parseFloat(getComputedStyle(tv).borderRadius) || 12;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 28 * scale; ctx.shadowOffsetY = 12 * scale;
    ctx.fillStyle = metal; ctx.beginPath(); ctx.roundRect(tvBox.left, tvBox.top, tvBox.width, tvBox.height, radius); ctx.fill(); ctx.restore();
    ctx.strokeStyle = '#60797b'; ctx.lineWidth = 1; ctx.stroke();
  }

  if (screen && screenBox?.width && screenBox.height) {
    ctx.save();
    ctx.beginPath(); ctx.roundRect(screenBox.left, screenBox.top, screenBox.width, screenBox.height,
      Number.parseFloat(getComputedStyle(screen).borderRadius) || 5); ctx.clip();
    ctx.fillStyle = '#010304'; ctx.fillRect(screenBox.left, screenBox.top, screenBox.width, screenBox.height);
    const media = hasLiveFrame ? video : stage.querySelector<HTMLCanvasElement>('.dream-canvas canvas');
    if (media) {
      const sourceWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.width;
      const sourceHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.height;
      if (sourceWidth > 0 && sourceHeight > 0) {
        // Cover the physical display without stretching its source image.
        const fit = Math.max(screenBox.width / sourceWidth, screenBox.height / sourceHeight);
        const width = sourceWidth * fit, height = sourceHeight * fit;
        ctx.drawImage(media, screenBox.left + (screenBox.width - width) / 2,
          screenBox.top + (screenBox.height - height) / 2, width, height);
      }
    }
    ctx.restore();
  }

  if (specimen?.width && specimen.height) {
    const box = specimen.getBoundingClientRect();
    // The source canvas already uses the stage camera's aspect. Preserve its exact CSS rectangle; the stage
    // transform above scales both axes equally, so the fly and projected brain anchor retain their geometry.
    if (box.width && box.height) ctx.drawImage(specimen, box.left, box.top, box.width, box.height);
  }

  if (cable) {
    const opacity = Number.parseFloat(getComputedStyle(cable).opacity) || 0;
    for (const path of cable.querySelectorAll<SVGPathElement>('.cable-sheath, .cable-edge, .cable-signal')) {
      const d = path.getAttribute('d');
      const matrix = path.getScreenCTM();
      if (!d || !matrix) continue;
      const geometry = new Path2D(); geometry.addPath(new Path2D(d), matrix);
      const style = getComputedStyle(path);
      const strokeScale = style.vectorEffect === 'non-scaling-stroke' ? 1 : Math.hypot(matrix.a, matrix.b);
      ctx.save();
      ctx.globalAlpha = opacity * (Number.parseFloat(style.opacity) || 0) * (Number.parseFloat(style.strokeOpacity) || 0);
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = (Number.parseFloat(style.strokeWidth) || 1) * strokeScale;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const dash = style.strokeDasharray.split(/[ ,]+/).map(Number.parseFloat).filter(Number.isFinite);
      ctx.setLineDash(dash.map(value => value * strokeScale));
      ctx.lineDashOffset = (Number.parseFloat(style.strokeDashoffset) || 0) * strokeScale;
      if (path.classList.contains('cable-signal')) { ctx.shadowColor = '#54eadb'; ctx.shadowBlur = 9 * scale; }
      ctx.stroke(geometry); ctx.restore();
    }
  }

  if (port) {
    const box = port.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const radius = Math.max(3, Math.min(box.width, box.height) / 2);
    ctx.fillStyle = '#061013'; ctx.beginPath(); ctx.arc(x, y, radius + 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7cead8'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = '#ecf1ef'; ctx.font = '600 22px "DM Sans", sans-serif'; ctx.fillText('FLY / THOUGHTS', 48, 53);
  ctx.fillStyle = '#829d9c'; ctx.font = '11px monospace'; ctx.textAlign = 'right';
  ctx.fillText(hasLiveFrame ? 'H3 DIRECTOR' : live ? 'H3 · WAITING FOR VIDEO' : 'LOCAL VISUAL STUDY', 1552, 52);
  ctx.textAlign = 'left'; ctx.fillStyle = '#799693'; ctx.font = '12px monospace';
  ctx.fillText((stage.querySelector('[data-stimulus-indicator]')?.textContent || 'Input · None').toUpperCase(), 48, 812, 1400);
  ctx.fillStyle = '#506a6b'; ctx.fillRect(48, 832, 1504, 1);
  ctx.font = '12px monospace'; ctx.fillStyle = '#a5b9b5';
  ctx.fillText(`${snapshot.source === 'connectome' ? 'SIMULATED CONNECTOME' : 'BRAIN OFFLINE'} · ${snapshot.neurons.toLocaleString()} NODES · ${snapshot.totalSpikes.toLocaleString()} SPIKES / ${snapshot.windowMs || 50} ms`, 48, 864);
  ctx.textAlign = 'right'; ctx.fillStyle = '#607b79'; ctx.font = '11px monospace';
  ctx.fillText('NEURAL ACTIVITY → ARTISTIC INTERPRETATION', 1552, 864); ctx.textAlign = 'left';
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
        if (elapsed >= 30) requestStop();
        } catch (cause) { fail(cause instanceof Error ? cause.message : 'Could not capture the cinema frame.'); }
      };
      recorder.start(1000);
      if (finished) return;
      setSeconds(0); frame = requestAnimationFrame(draw);
      // RAF pauses in background tabs; recording duration must not depend on drawing another frame.
      stopTimer = setTimeout(requestStop, 30000);
    } catch (cause) { fail(cause instanceof Error ? cause.message : 'Could not begin recording.'); }
  }, [stop]);
  return { seconds, error, start, stop };
}
