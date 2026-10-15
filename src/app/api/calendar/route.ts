import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import { calendarWorkspace } from "@/lib/server/calendar";
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
