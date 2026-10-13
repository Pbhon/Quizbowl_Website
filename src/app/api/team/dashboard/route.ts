import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import { loadTeamRoster, requireTeamStaff } from "@/lib/server/team-dashboard";
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
    const members = await loadTeamRoster(account.db, teamId);
    await requireTeamStaff(account.db, account.uid, user.emailVerified);
    return Response.json({ members }, { headers });
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
