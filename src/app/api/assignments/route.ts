import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import { assignmentWorkspace, saveAssignment } from "@/lib/server/assignments";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
async function handle(request: Request, write: boolean) {
  try {
    const account = (await authenticatePractice(request))!;
    const user = await getFirebaseAdmin().auth.getUser(account.uid);
    let body: Record<string, unknown> = {};
    if (write) {
      const text = await request.text();
      if (text.length > 20000)
        throw new PracticeError("Request too large.", 413);
      body = JSON.parse(text);
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new PracticeError("Invalid assignment.", 400);
    }
    return Response.json(
      write
        ? await saveAssignment(
            account.db,
            account.uid,
            user.emailVerified,
            body,
          )
        : await assignmentWorkspace(
            account.db,
            account.uid,
            user.emailVerified,
          ),
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : error instanceof SyntaxError
              ? "Invalid request."
              : "Assignments could not be loaded or saved. Please retry.",
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
export async function GET(request: Request) {
  return handle(request, false);
}
export async function POST(request: Request) {
  return handle(request, true);
}
