import { getFirebaseAdmin } from "@/lib/firebase/admin";
import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import {
  generateSavedClues,
  savedClueStatus,
} from "@/lib/server/ai-generation";
import { GenerationError } from "@/lib/server/generation-error";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
export async function GET(request: Request) {
  try {
    const account = (await authenticatePractice(request))!;
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some((key) => !["deckId", "cardId"].includes(key)) ||
      params.getAll("deckId").length !== 1 ||
      params.getAll("cardId").length !== 1
    )
      throw new PracticeError("Choose a saved deck and card.", 400);
    const user = await getFirebaseAdmin().auth.getUser(account.uid);
    return Response.json(
      await savedClueStatus(
        account.db,
        account.uid,
        params.get("deckId"),
        params.get("cardId"),
        user.emailVerified,
      ),
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        ...(error instanceof GenerationError
          ? { retryAt: error.retryAt, generation: error.generation }
          : {}),
        error:
          error instanceof PracticeError
            ? error.message
            : "Generation status is unavailable.",
      },
      { status: error instanceof PracticeError ? error.status : 503, headers },
    );
  }
}
export async function POST(request: Request) {
  try {
    const account = (await authenticatePractice(request))!;
    const text = await request.text();
    if (text.length > 2048) throw new PracticeError("Request too large.", 413);
    const body = JSON.parse(text);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) =>
          !["deckId", "cardId", "regenerate", "expectedRevision"].includes(key),
      ) ||
      (body.regenerate !== undefined && typeof body.regenerate !== "boolean") ||
      (body.expectedRevision !== undefined &&
        (body.regenerate !== true || typeof body.expectedRevision !== "string"))
    )
      throw new PracticeError("Choose a saved deck and card.", 400);
    const user = await getFirebaseAdmin().auth.getUser(account.uid);
    return Response.json(
      await generateSavedClues(
        account.db,
        account.uid,
        body.deckId,
        body.cardId,
        user.emailVerified,
        {
          regenerate: body.regenerate,
          expectedRevision: body.expectedRevision,
        },
      ),
      { headers },
    );
  } catch (error) {
    const status =
      error instanceof PracticeError
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 503;
    return Response.json(
      {
        ...(error instanceof GenerationError
          ? { retryAt: error.retryAt, generation: error.generation }
          : {}),
        error:
          error instanceof PracticeError
            ? error.message
            : "Clues could not be generated. Please retry.",
      },
      {
        status,
        headers: {
          ...headers,
          ...(error instanceof GenerationError
            ? {
                "Retry-After": String(
                  Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)),
                ),
              }
            : [429, 409].includes(status)
              ? { "Retry-After": "60" }
              : {}),
        },
      },
    );
  }
}
