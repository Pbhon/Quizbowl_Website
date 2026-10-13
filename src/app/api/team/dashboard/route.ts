import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import {
  loadTeamDashboard,
  requireTeamStaff,
} from "@/lib/server/team-dashboard";
import { teamStatisticsCSV } from "@/lib/team-dashboard";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Authorization",
  };
  try {
    const account = (await authenticatePractice(request))!;
    const user = await getFirebaseAdmin().auth.getUser(account.uid);
    const teamId = await requireTeamStaff(
      account.db,
      account.uid,
      user.emailVerified,
    );
    const timeZone = new URL(request.url).searchParams.get("timeZone") || "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
      throw new PracticeError("Invalid time zone.", 400);
    }
    const data = await loadTeamDashboard(account.db, teamId, timeZone);
    await requireTeamStaff(account.db, account.uid, user.emailVerified);
    const params = new URL(request.url).searchParams;
    if (params.get("format") === "csv") {
      const studentUid = params.get("student") || undefined;
      if (studentUid && !data.students.some((s) => s.uid === studentUid))
        throw new PracticeError("Student not found in your school.", 404);
      return new Response(teamStatisticsCSV(data, studentUid), {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="quizbowl-${studentUid ? "student" : "team"}-statistics.csv"`,
        },
      });
    }
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : "Team statistics could not be loaded. Please retry.",
      },
      { status: error instanceof PracticeError ? error.status : 503, headers },
    );
  }
}
