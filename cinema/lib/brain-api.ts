import { assertLocalRequest } from './server/guards';

export function allowedOrigin(request: Request): boolean {
  // Next may normalize request.url to localhost even when the browser uses 127.0.0.1.
  // Validate the browser origin against the actual Host header, as the fal routes do.
  try { assertLocalRequest(request); return true; } catch { return false; }
}
export function brainUrl(): string {
  const url = new URL(process.env.BRAIN_URL || 'http://127.0.0.1:8766');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('BRAIN_URL must point to a local brain bridge.');
  return url.origin;
}
