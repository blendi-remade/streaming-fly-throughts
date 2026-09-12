import { createFalClient } from "@fal-ai/client";
import { CINEMATIC_STYLE, DIRECTOR_SYSTEM_PROMPT, interpretBrain, type CinematicDirection } from "../../../lib/cinematic";
import { parseDirectorInput } from "../../../lib/server/director-input";
import { assertLocalRequest, jsonResponse, limitRequests, readBoundedJson, RequestError, requestErrorResponse } from "../../../lib/server/guards";

export const runtime = "nodejs";
export const maxDuration = 30;

/** LLM prose is opt-in. Direct mode never creates a provider request. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request);
    const { telemetry, history, start, mode } = parseDirectorInput(await readBoundedJson(request));
    if (telemetry.source !== "connectome") throw new RequestError("Live cinema requires the connected brain simulation. Rehearsal uses the local artistic preview.", 409);
    const fallback = interpretBrain(telemetry, start);
    if (mode === "direct") return jsonResponse(fallback);
    const key = process.env.FAL_KEY?.trim();
    if (!key) return jsonResponse({ ...fallback, warning: "FAL_KEY is not configured. Using the deterministic artistic translator." });
    limitRequests("director-translation", 15);
    try {
      const client = createFalClient({ credentials: key });
      const timeout = AbortSignal.timeout(18_000);
      const signal = AbortSignal.any([request.signal, timeout]);
      const result = await client.run("openrouter/router", {
        abortSignal: signal,
        input: {
          model: "google/gemini-2.5-flash-lite",
          system_prompt: DIRECTOR_SYSTEM_PROMPT,
          prompt: JSON.stringify({ opening: start, source: telemetry.source, drive: fallback.drive, sensoryTheme: fallback.sensoryTheme ?? null, evidence: fallback.evidence, experimentalInput: telemetry.stimulus, priorScenes: history, suggestedScene: fallback.prompt.split(CINEMATIC_STYLE)[0] }),
          max_tokens: 500,
          temperature: 0.8,
        },
      });
      const output = (result.data as { output?: string }).output;
      if (typeof output !== "string" || output.length > 12_000) throw new Error("Invalid model output");
      const startIndex = output.indexOf("{");
      const endIndex = output.lastIndexOf("}");
      if (startIndex < 0 || endIndex <= startIndex) throw new Error("Missing model JSON");
      const parsed = JSON.parse(output.slice(startIndex, endIndex + 1)) as Record<string, unknown>;
      if (parsed.drive !== fallback.drive || typeof parsed.prompt !== "string" || parsed.prompt.trim().length < 30 || parsed.prompt.length > 1_600 || typeof parsed.caption !== "string" || parsed.caption.length > 140 || !parsed.caption.trim() || typeof parsed.reason !== "string") throw new Error("Invalid model fields");
      // The LLM is a cinematographer, not a source of scientific evidence. Its reason is
      // deliberately not returned: attribution is rebuilt from the measured readout.
      const direction: CinematicDirection = {
        ...fallback,
        prompt: `${parsed.prompt.trim()} ${CINEMATIC_STYLE}`,
        caption: parsed.caption.trim(),
        translator: "llm",
      };
      return jsonResponse(direction);
    } catch {
      if (request.signal.aborted) return jsonResponse({ error: "Translation cancelled." }, 499);
      return jsonResponse({ ...fallback, warning: "The language model is unavailable. Continuing with the deterministic artistic translator." });
    }
  } catch (error) { return requestErrorResponse(error); }
}
