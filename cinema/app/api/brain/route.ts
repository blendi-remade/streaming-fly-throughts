import { allowedOrigin, brainUrl } from '@/lib/brain-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const response = await fetch(`${brainUrl()}/state`, { cache: 'no-store', signal: AbortSignal.timeout(1800) });
    if (!response.ok) throw new Error('Brain bridge is starting.');
    return Response.json(await response.json(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'The brain is not connected. Start it with npm run brain in the cinema folder.' }, { status: 503 });
  }
}
export async function POST(request: Request) {
  if (!allowedOrigin(request)) return Response.json({ error: 'Origin not allowed.' }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 1024) return Response.json({ error: 'Request too large.' }, { status: 413 });
    let body;
    try { body = JSON.parse(text); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Expected a JSON object.' }, { status: 400 });
    if (!['sugar', 'bitter', 'loom', 'touch', 'odor', 'clear', 'reset'].includes(body.kind)) return Response.json({ error: 'Unknown stimulus.' }, { status: 400 });
    const intensity = typeof body.intensity === 'number' && Number.isFinite(body.intensity) ? Math.max(0, Math.min(1, body.intensity)) : 0.8;
    const durationMs = typeof body.durationMs === 'number' && Number.isFinite(body.durationMs) ? Math.max(250, Math.min(15000, body.durationMs)) : 9000;
    const response = await fetch(`${brainUrl()}/${body.kind === 'reset' ? 'reset' : 'stimulus'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.kind === 'reset' ? {} : { kind: body.kind, intensity, durationMs }),
      signal: AbortSignal.timeout(2000),
    });
    const acknowledgement = await response.json();
    return Response.json(response.ok && acknowledgement.accepted === true
      ? { ...acknowledgement, acceptedAt: Date.now() }
      : acknowledgement, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Could not reach the brain bridge.' }, { status: 503 }); }
}
