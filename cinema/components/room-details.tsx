'use client';
import { useEffect, useRef } from 'react';

/** Decorative set dressing only. Neural measurements live in the separate HUD. */
export function RoomDetails() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current, ctx = node?.getContext('2d');
    if (!node || !ctx) return;
    let frame = 0, last = -Infinity, width = 0, height = 0;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const resize = () => {
      const box = node.getBoundingClientRect(); width = box.width; height = box.height;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      node.width = Math.round(width * ratio); node.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); last = -Infinity;
    };
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (!width || !height || now - last < (motion.matches ? 1000 : 100)) return;
      last = now;
      const w = width, h = height, mobile = w < 760, time = motion.matches ? 0 : now * 0.00012;
      ctx.clearRect(0, 0, w, h);
      const polygon = (points: number[][], fill: string, stroke?: string) => {
        ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
      };
      // Recessed window: deterministic city geometry, with a few slowly changing lights.
      const bottom = h * (mobile ? 0.39 : 0.48);
      const sky = ctx.createLinearGradient(0, 0, 0, bottom);
      sky.addColorStop(0, '#0b111e'); sky.addColorStop(1, '#12232a');
      ctx.fillStyle = sky; ctx.fillRect(w * 0.035, h * 0.065, w * 0.93, bottom - h * 0.065);
      for (let i = 0; i < 27; i++) {
        const x = w * (0.04 + i * 0.035), bw = w * (0.023 + (i % 3) * 0.007);
        const top = h * (0.11 + ((i * 17) % 19) / 100);
        ctx.fillStyle = i % 2 ? '#0a1420' : '#0c1924'; ctx.fillRect(x, top, bw, bottom - top);
        for (let row = 0; row < 25; row++) for (let col = 0; col < 3; col++) {
          const y = top + 9 + row * 12;
          if (y > bottom || (i * 13 + row * 7 + col * 11) % 9 > 2) continue;
          ctx.globalAlpha = 0.2 + 0.15 * Math.sin(time + i + row);
          ctx.fillStyle = (i + row + col) % 4 === 0 ? '#ad739f' : '#68a9b8';
          ctx.fillRect(x + 5 + col * bw * 0.25, y, Math.max(1, bw * 0.065), 3);
        }
      }
      ctx.globalAlpha = 1;
      const veil = ctx.createLinearGradient(0, 0, 0, bottom + 30);
      veil.addColorStop(0, '#07101522'); veil.addColorStop(0.7, '#07131744'); veil.addColorStop(1, '#0b191df5');
      ctx.fillStyle = veil; ctx.fillRect(w * 0.035, h * 0.065, w * 0.93, bottom - h * 0.065);
      ctx.strokeStyle = '#23353c'; ctx.lineWidth = 2;
      ctx.strokeRect(w * 0.035, h * 0.065, w * 0.93, bottom - h * 0.065);
      for (const x of [0.25, 0.49, 0.73]) {
        ctx.fillStyle = '#081318'; ctx.fillRect(w * x, h * 0.065, 7, bottom - h * 0.065);
        ctx.fillStyle = '#28373f'; ctx.fillRect(w * x + 7, h * 0.065, 1, bottom - h * 0.065);
      }
      // Overhead light and its housing.
      const lx = w * (mobile ? 0.49 : 0.12), ly = h * 0.085, lw = w * (mobile ? 0.33 : 0.21);
      ctx.fillStyle = '#1c2c34'; ctx.fillRect(lx - 5, ly - 5, lw + 10, 11);
      ctx.save(); ctx.shadowColor = '#7fd8d1'; ctx.shadowBlur = 16;
      ctx.fillStyle = '#85c1bd'; ctx.fillRect(lx, ly, lw, 2); ctx.restore();
      // A bevelled workbench gives the specimen and display a shared physical surface.
      const back = h * (mobile ? 0.29 : 0.59), front = h * 0.91;
      polygon([[w * 0.025, back], [w * 0.89, back - h * 0.08], [w * 1.04, front - h * 0.04], [w * 0.06, front]], '#111f25', '#273940');
      const surface = ctx.createLinearGradient(0, back, 0, front);
      surface.addColorStop(0, '#1b313429'); surface.addColorStop(1, '#0a141a99');
      ctx.fillStyle = surface; ctx.fillRect(w * 0.07, back, w * 0.82, front - back);
      polygon([[w * 0.06, front], [w * 1.04, front - h * 0.04], [w * 1.04, front - h * 0.018], [w * 0.06, front + h * 0.018]], '#081118', '#21353e');
      ctx.save(); ctx.strokeStyle = '#62b4b3'; ctx.shadowColor = '#3ba9a7'; ctx.shadowBlur = 8; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(w * 0.061, front + 2); ctx.lineTo(w, front - h * 0.037); ctx.stroke(); ctx.restore();
      // Small keyboard and a ventilated instrument tower, kept below the movie.
      if (!mobile) {
        const kx = w * 0.69, ky = h * 0.867, kw = w * 0.18, kh = h * 0.028;
        polygon([[kx, ky], [kx + kw, ky - 5], [kx + kw + 9, ky + kh], [kx - 9, ky + kh + 5]], '#15262e', '#3b4e58');
        ctx.fillStyle = '#496168';
        for (let row = 0; row < 3; row++) for (let col = 0; col < 20; col++) ctx.fillRect(kx + col * kw / 21, ky + row * kh / 3 - col * 0.2 + 2, kw / 26, 1);
        const tx = w * 0.92, ty = h * 0.79, tw = w * 0.048, th = h * 0.12;
        polygon([[tx, ty], [tx + tw, ty + 3], [tx + tw, ty + th], [tx, ty + th + 2]], '#0a151f', '#2b424e');
        polygon([[tx - 9, ty - 6], [tx, ty], [tx, ty + th + 2], [tx - 9, ty + th - 6]], '#17212f', '#283741');
        for (let fan = 0; fan < 2; fan++) {
          const fx = tx + tw * 0.5, fy = ty + th * (0.29 + fan * 0.45), radius = Math.min(tw * 0.3, th * 0.18);
          ctx.strokeStyle = fan ? '#69567e' : '#599b9f'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(fx, fy, radius, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = '#30464d'; ctx.lineWidth = 1;
          for (let blade = 0; blade < 5; blade++) {
            const a = blade * Math.PI * 0.4 + time * 3;
            ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo(fx + Math.cos(a + 0.5) * radius, fy + Math.sin(a + 0.5) * radius, fx + Math.cos(a) * radius * 0.82, fy + Math.sin(a) * radius * 0.82); ctx.stroke();
          }
        }
      }
      // Bench ruler: physical markings, never synthetic neural telemetry.
      ctx.strokeStyle = '#52727155'; ctx.lineWidth = 1;
      for (let i = 0; i < 28; i++) {
        const x = w * 0.29 + i * w * 0.007;
        ctx.beginPath(); ctx.moveTo(x, front - 10 - i * 0.18); ctx.lineTo(x, front - (i % 5 ? 14 : 20) - i * 0.18); ctx.stroke();
      }
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(node);
    frame = requestAnimationFrame(draw);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return <canvas className="room-details" data-room aria-hidden="true" ref={canvas} />;
}
