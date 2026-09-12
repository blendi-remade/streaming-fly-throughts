'use client';
import { useEffect, useRef, type RefObject } from 'react';

type Props = {
  stage: RefObject<HTMLElement | null>;
  specimen: RefObject<HTMLDivElement | null>;
  port: RefObject<HTMLDivElement | null>;
  anchor: RefObject<{ x: number; y: number } | null>;
  activity: number;
};

/** Endpoints are measured from the rendered connector and TV port, never guessed percentages. */
export function SignalCable({ stage, specimen, port, anchor, activity }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const latest = useRef(activity); latest.current = activity;
  useEffect(() => {
    let frame = 0, last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 25 || document.hidden) return;
      last = now;
      if (!stage.current || !specimen.current || !port.current || !anchor.current || !svg.current) return;
      const area = stage.current.getBoundingClientRect(), fly = specimen.current.getBoundingClientRect(), socket = port.current.getBoundingClientRect();
      if (!area.width || !area.height) return;
      const x = fly.left - area.left + anchor.current.x * fly.width;
      const y = fly.top - area.top + anchor.current.y * fly.height;
      const endX = socket.left - area.left + socket.width / 2, endY = socket.top - area.top + socket.height / 2;
      // A short upward strain relief leaves the connector; a single cable falls in a slack loop.
      const lowY = Math.min(area.height - 75, Math.max(y, endY) + Math.min(170, area.height * .23));
      let d: string;
      if (endY > y + 100 && endX < x) {
        // In a stacked layout, route through the empty gap and along the TV's left edge.
        // Running the desktop loop here would cross the picture and leave the stage.
        const frameTop = port.current.parentElement!.getBoundingClientRect().top - area.top;
        const corridorX = Math.max(12, endX - 28);
        const bendY = Math.max(y + 62, frameTop - 24);
        d = `M ${x} ${y} C ${x + 20} ${y - 36}, ${x + 65} ${y - 20}, ${x + 55} ${y + 20} C ${x + 58} ${bendY}, ${corridorX} ${bendY - 52}, ${corridorX} ${bendY} C ${corridorX} ${endY - 25}, ${corridorX} ${endY}, ${endX} ${endY}`;
      } else {
        // Keep a genuine U-shaped slack loop even when the head and port are close.
        // Coincident control points produce a pinched tip that looks like a loose end.
        const loopLeft = Math.max(12, Math.min(x + 25, endX - 80));
        const loopRight = Math.max(loopLeft + 42, endX - 32);
        d = `M ${x} ${y} C ${x - 15} ${y - 35}, ${x + 25} ${y - 42}, ${x + 29} ${y - 5} C ${x + 37} ${y + 60}, ${loopLeft} ${lowY - 50}, ${loopLeft} ${lowY - 15} C ${loopLeft} ${lowY + 35}, ${loopRight} ${lowY + 35}, ${loopRight} ${lowY - 10} C ${loopRight} ${endY + 35}, ${endX - 35} ${endY}, ${endX} ${endY}`;
      }
      svg.current.setAttribute('viewBox', `0 0 ${area.width} ${area.height}`);
      svg.current.style.opacity = '1';
      paths.current.forEach(path => path?.setAttribute('d', d));
      svg.current.style.setProperty('--signal-opacity', String(.2 + latest.current * .65));
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [stage, specimen, port, anchor]);
  return <svg ref={svg} className="signal-cable" aria-hidden="true" preserveAspectRatio="none" style={{ opacity: 0 }}>
    <path ref={node => { paths.current[0] = node; }} className="cable-shadow" />
    <path ref={node => { paths.current[1] = node; }} className="cable-sheath" />
    <path ref={node => { paths.current[2] = node; }} className="cable-edge" />
    <path ref={node => { paths.current[3] = node; }} className="cable-signal" />
  </svg>;
}
