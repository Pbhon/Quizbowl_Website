import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { saveHistoryToDeck } from "@/lib/server/history";
import { studyDecks, mutateDeck } from "@/lib/server/decks";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import { requireTeamStaff } from "@/lib/server/team-dashboard";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof PracticeError
          ? error.message
          : error instanceof SyntaxError
            ? "Invalid request."
            : "Your decks could not be saved or loaded. Please retry.",
    },
    {
      status:
        error instanceof PracticeError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 503,
      headers,
    },
  );
}
export async function GET(request: Request) {
  try {
    const account = (await authenticatePractice(request))!;
    const user = await getFirebaseAdmin().auth.getUser(account.uid);
    return Response.json(
      { decks: await studyDecks(account.db, account.uid, user.emailVerified) },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const account = (await authenticatePractice(request))!;
    const text = await request.text();
    if (text.length > 200000)
      throw new PracticeError("Request too large.", 413);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new PracticeError("Invalid request.", 400);
    if (
      (body.ownerUid !== undefined && body.ownerUid !== account.uid) ||
      body.curatedBy !== undefined ||
      body.sharedId !== undefined
    )
      throw new PracticeError(
        "Shared source decks cannot be edited. Copy a card into your own deck instead.",
        403,
      );
    const user = await getFirebaseAdmin().auth.getUser(account.uid);
    if (body.teacherCurated === true || body.action === "shareTeacher") {
      await requireTeamStaff(account.db, account.uid, user.emailVerified);
    }
    return Response.json(
      body.action === undefined
        ? await saveHistoryToDeck(
            account.db,
            account.uid,
            body,
            user.emailVerified,
          )
        : await mutateDeck(account.db, account.uid, body, user.emailVerified),
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
