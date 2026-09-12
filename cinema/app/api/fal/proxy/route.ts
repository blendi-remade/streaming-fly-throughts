import { assertLocalRequest, jsonResponse, limitRequests, readBoundedJson, RequestError, requestErrorResponse } from "../../../../lib/server/guards";

export const runtime = "nodejs";
export const maxDuration = 120;
const ENDPOINT = "minimax/h3-max/director";
const ALLOWED = new Set(["https://wma.fal.run/ice", "https://wma.fal.run/session", "https://wma.fal.run/session/heartbeat", `https://fal.run/${ENDPOINT}/ice`]);

/** SDK-compatible, tightly scoped signalling proxy. Media flows over WebRTC. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request);
    const key = process.env.FAL_KEY?.trim();
    if (!key) return jsonResponse({ error: "Add FAL_KEY to cinema/.env.local and restart the app to enable Director." }, 503);
    const target = request.headers.get("x-fal-target-url");
    if (!target || !ALLOWED.has(target)) throw new RequestError("This proxy only permits the Director signalling endpoints.", 403);
    const body = await readBoundedJson(request, 131_072);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Invalid signalling payload.");
    const payload = body as Record<string, unknown>;
    if (target === "https://wma.fal.run/session/heartbeat") {
      if (typeof payload.session_id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(payload.session_id) || Object.keys(payload).length !== 1) throw new RequestError("Invalid session heartbeat.");
      limitRequests("director-heartbeat", 35);
    } else if (target === `https://fal.run/${ENDPOINT}/ice`) {
      if (Object.keys(payload).length > 0) throw new RequestError("Invalid ICE request.");
      limitRequests("director-ice", 10);
    } else {
      if (payload.app_id !== ENDPOINT) throw new RequestError("Only the configured Director model is permitted.", 403);
      if (target.endsWith("/session")) {
        if (payload.type !== "offer" || typeof payload.sdp !== "string" || payload.sdp.length > 100_000 || !payload.sdp.startsWith("v=0") || Object.keys(payload).some(key => !["app_id", "type", "sdp"].includes(key))) throw new RequestError("Invalid session offer.");
        limitRequests("director-open", 4);
      } else {
        if (Object.keys(payload).length !== 1) throw new RequestError("Invalid ICE request.");
        limitRequests("director-ice", 10);
      }
    }
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(target.endsWith("/session") ? 100_000 : 12_000)]),
      redirect: "error",
      cache: "no-store",
    });
    // Do not forward arbitrary upstream headers or echo diagnostics containing credentials.
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return jsonResponse({ error: upstream.status === 401 || upstream.status === 403 ? "fal rejected the API credentials or model access." : `Director signalling returned HTTP ${upstream.status}.` }, upstream.status);
    }
    return new Response(upstream.body, { status: upstream.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) { return requestErrorResponse(error); }
}
