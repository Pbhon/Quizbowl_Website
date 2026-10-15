import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import { calendarWorkspace, saveCalendar } from "@/lib/server/calendar";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
export async function GET(request: Request) {
  try {
    const account = (await authenticatePractice(request))!;
    const user = await getFirebaseAdmin().auth.getUser(account.uid);
    return Response.json(
      await calendarWorkspace(account.db, account.uid, user.emailVerified),
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : "Calendar could not be loaded. Please retry.",
      },
      { status: error instanceof PracticeError ? error.status : 503, headers },
    );
  }
}
export async function POST(request: Request) {
  try {
    const account = (await authenticatePractice(request))!;
    const user = await getFirebaseAdmin().auth.getUser(account.uid);
    const text = await request.text();
    if (text.length > 12000) throw new PracticeError("Request too large.", 413);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new PracticeError("Invalid calendar request.", 400);
    return Response.json(
      await saveCalendar(account.db, account.uid, user.emailVerified, body),
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : error instanceof SyntaxError
              ? "Invalid calendar request."
              : "Calendar could not be saved. Please retry.",
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
}
