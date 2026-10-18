import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { readGenerationUsage } from "@/lib/server/generation-usage";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };

export async function GET(request: Request) {
  try {
    const account = (await authenticatePractice(request))!;
    if (new URL(request.url).search)
      throw new PracticeError(
        "Usage is available only for your signed-in account.",
        400,
      );
    return Response.json(
      { usage: await readGenerationUsage(account.db, account.uid) },
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : "AI usage is unavailable. Please retry.",
      },
      { status: error instanceof PracticeError ? error.status : 503, headers },
    );
  }
}
