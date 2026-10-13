import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { siteTeam } from "./site-team";
import { PracticeError } from "./practice-persistence";

export async function requireTeamStaff(
  db: Firestore,
  uid: string,
  verified: boolean,
) {
  const teamId = siteTeam().id;
  const staff = (await db.doc(`staff/${uid}`).get()).data();
  if (
    !verified ||
    !staff ||
    !["teacher", "admin"].includes(staff.role) ||
    staff.teamId !== teamId
  )
    throw new PracticeError("Verified school staff access is required.", 403);
  return teamId;
}
export async function loadTeamRoster(db: Firestore, teamId: string) {
  const members = await db.collection(`teams/${teamId}/members`).get();
  return Promise.all(
    members.docs.map(async (doc) => {
      const staff = (await db.doc(`staff/${doc.id}`).get()).data();
      return {
        uid: doc.id,
        displayName: String(doc.data().displayName || "Team member"),
        role:
          staff?.teamId === teamId && ["teacher", "admin"].includes(staff.role)
            ? (staff.role as "teacher" | "admin")
            : ("student" as const),
      };
    }),
  ).then((rows) =>
    rows.sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName) ||
        a.uid.localeCompare(b.uid),
    ),
  );
}
