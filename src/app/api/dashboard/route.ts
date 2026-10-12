import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { loadDashboard } from "@/lib/server/dashboard";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Authorization",
  };
  try {
    const account = await authenticatePractice(request);
    const timeZone = new URL(request.url).searchParams.get("timeZone") || "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
      throw new PracticeError("Invalid time zone.", 400);
    }
    return Response.json(
      await loadDashboard(account!.db, account!.uid, timeZone),
      { headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : "Your statistics could not be loaded. Please retry.",
      },
      { status: error instanceof PracticeError ? error.status : 503, headers },
    );
  }
}
