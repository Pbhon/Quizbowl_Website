import { getFirebaseAdmin } from "@/lib/firebase/admin";
import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { generateSavedClues } from "@/lib/server/ai-generation";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
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
      Object.keys(body).some((key) => !["deckId", "cardId"].includes(key))
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
        error:
          error instanceof PracticeError
            ? error.message
            : "Clues could not be generated. Please retry.",
      },
      {
        status,
        headers: {
          ...headers,
          ...([429, 409].includes(status) ? { "Retry-After": "60" } : {}),
        },
      },
    );
  }
}
