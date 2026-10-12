import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { loadHistory } from "@/lib/server/history";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
export async function GET(request: Request) {
  try {
    const account = (await authenticatePractice(request))!;
    return Response.json(
      await loadHistory(
        account.db,
        account.uid,
        new URL(request.url).searchParams,
      ),
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : "Your history could not be loaded. Please retry.",
      },
      { status: error instanceof PracticeError ? error.status : 503, headers },
    );
  }
}
