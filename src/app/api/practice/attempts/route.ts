import {
  authenticatePractice,
  parseAttempt,
  PracticeError,
  savePracticeAttempt,
} from "@/lib/server/practice-persistence";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const account = await authenticatePractice(request);
    const input = parseAttempt(await request.json());
    const result = await savePracticeAttempt(account!.db, account!.uid, input);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : error instanceof SyntaxError
              ? "Invalid request."
              : "Your response could not be saved. Please retry.",
      },
      {
        status:
          error instanceof PracticeError
            ? error.status
            : error instanceof SyntaxError
              ? 400
              : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
