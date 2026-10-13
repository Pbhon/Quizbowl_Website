import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { recordStudyReview } from "@/lib/server/study-activity";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Authorization",
  };
  try {
    const account = (await authenticatePractice(request))!;
    const text = await request.text();
    if (text.length > 2000) throw new PracticeError("Request too large.", 413);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new PracticeError("Invalid request.", 400);
    return Response.json(
      await recordStudyReview(account.db, account.uid, body),
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : "Review could not be saved. Please retry.",
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
