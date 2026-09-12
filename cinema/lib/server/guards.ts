export class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const loopback = (host: string) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);

/** Local-first application: browser writes must originate from the exact loopback host. */
export function assertLocalRequest(request: Request, requireOrigin = true): void {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  let requested: URL;
  try { requested = new URL(`${url.protocol}//${host}`); }
  catch { throw new RequestError("Invalid host.", 403); }
  if (!loopback(requested.hostname)) throw new RequestError("This API is available on localhost only.", 403);
  const origin = request.headers.get("origin");
  if (!origin) {
    if (requireOrigin) throw new RequestError("A same-origin browser request is required.", 403);
    return;
  }
  let source: URL;
  try { source = new URL(origin); }
  catch { throw new RequestError("Invalid origin.", 403); }
  if (source.origin !== requested.origin) throw new RequestError("Cross-origin requests are not permitted.", 403);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new RequestError("Cross-site requests are not permitted.", 403);
}

export async function readBoundedJson(request: Request, limit = 32_768): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new RequestError("Expected application/json.", 415);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > limit) throw new RequestError("Request is too large.", 413);
  if (!request.body) throw new RequestError("A JSON body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new RequestError("Request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestError("Invalid JSON."); }
}

const buckets = new Map<string, { at: number; count: number }>();
export function limitRequests(bucket: string, maximum: number, windowMs = 60_000): void {
  const now = Date.now();
  const existing = buckets.get(bucket);
  if (!existing || now - existing.at >= windowMs) { buckets.set(bucket, { at: now, count: 1 }); return; }
  if (existing.count >= maximum) throw new RequestError("Too many requests. Wait a moment and retry.", 429);
  existing.count += 1;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function requestErrorResponse(error: unknown): Response {
  return jsonResponse({ error: error instanceof RequestError ? error.message : "The request could not be completed." }, error instanceof RequestError ? error.status : 500);
}
