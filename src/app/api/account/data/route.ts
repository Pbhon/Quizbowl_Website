import { getFirebaseAdmin } from "@/lib/firebase/admin";
import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import {
  exportAccountData,
  requestAccountDeletion,
  requireRecentAuthentication,
} from "@/lib/server/account-data";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
async function account(request: Request) {
  const current = (await authenticatePractice(request))!;
  requireRecentAuthentication(current.authTime);
  return current;
}
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof PracticeError
          ? error.message
          : "Your data request could not be completed. Please retry.",
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
    const current = await account(request);
    if (new URL(request.url).search)
      throw new PracticeError(
        "Data exports do not accept account selectors.",
        400,
      );
    const user = await getFirebaseAdmin().auth.getUser(current.uid);
    const data = await exportAccountData(current.db, current.uid);
    return Response.json(
      {
        ...data,
        account: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          emailVerified: user.emailVerified,
          createdAt: user.metadata.creationTime,
        },
      },
      {
        headers: {
          ...headers,
          "Content-Disposition":
            'attachment; filename="quizbowl-account-data.json"',
        },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const current = await account(request);
    const text = await request.text();
    if (text.length > 512) throw new PracticeError("Request too large.", 413);
    const body = JSON.parse(text);
    if (
      !body ||
      body.action !== "request-deletion" ||
      Object.keys(body).length !== 1
    )
      throw new PracticeError("Confirm your account deletion request.", 400);
    return Response.json(
      await requestAccountDeletion(current.db, current.uid),
      { status: 202, headers },
    );
  } catch (error) {
    return failure(error);
  }
}
