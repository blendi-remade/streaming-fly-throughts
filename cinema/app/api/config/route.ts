import { assertLocalRequest, jsonResponse, requestErrorResponse } from "../../../lib/server/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request, false);
    const brainUrl = process.env.BRAIN_URL || "http://127.0.0.1:8766";
    return jsonResponse({ falConfigured: Boolean(process.env.FAL_KEY?.trim()), brainUrl });
  } catch (error) { return requestErrorResponse(error); }
}
