import "server-only";
import {
  subjectDifficulty,
  participation,
  assignmentCompletion,
} from "@/lib/team-dashboard";
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
import { buildStatistics, type StatisticAttempt } from "@/lib/statistics";
import { timestampISO } from "./dashboard";

export async function loadTeamDashboard(
  db: Firestore,
  teamId: string,
  timeZone: string,
  now = new Date(),
) {
  const members = await loadTeamRoster(db, teamId);
  const assignments = await db.collection(`teams/${teamId}/assignments`).get();
  const histories = await Promise.all(
    members
      .filter((m) => m.role === "student")
      .map(async (member) => {
        const attempts = await db
          .collection(`users/${member.uid}/attempts`)
          .get();
        const history = attempts.docs.map(
          (doc) =>
            ({
              ...doc.data(),
              completedAt: timestampISO(doc.data().completedAt),
            }) as StatisticAttempt,
        );
        const completion = await Promise.all(
          assignments.docs.map(async (doc) => {
            const data = doc.data();
            const normalized = { ...data, dueAt: timestampISO(data.dueAt) };
            if (
              !assignmentCompletion(
                doc.id,
                normalized,
                undefined,
                member.uid,
                now,
              )
            )
              return null;
            const progress = await doc.ref
              .collection("progress")
              .doc(member.uid)
              .get();
            return assignmentCompletion(
              doc.id,
              normalized,
              progress.data(),
              member.uid,
              now,
            );
          }),
        );
        return {
          member,
          history,
          assignments: completion.filter((row) => row !== null),
        };
      }),
  );
  const students = histories.map(({ member, history, assignments }) => ({
    ...member,
    assignments,
    statistics: buildStatistics(history, now, timeZone),
    heatmap: subjectDifficulty(history, now, timeZone),
    participation: participation(history, now, timeZone),
  }));
  const allAttempts = histories.flatMap(({ member, history }) =>
    history.map((attempt) => ({
      ...attempt,
      sessionId: `${member.uid}:${attempt.sessionId}`,
    })),
  );
  const team = buildStatistics(
    histories.flatMap(({ member, history }) =>
      history.map((attempt) => ({
        ...attempt,
        sessionId: `${member.uid}:${attempt.sessionId}`,
      })),
    ),
    now,
    timeZone,
  );
  // Recheck membership before releasing student data if a student was removed during loading.
  const current = await db.collection(`teams/${teamId}/members`).get();
  if (
    members.some((member) => !current.docs.some((doc) => doc.id === member.uid))
  )
    throw new PracticeError(
      "The roster changed. Refresh team statistics.",
      409,
    );
  return {
    members,
    students,
    team,
    heatmap: subjectDifficulty(allAttempts, now, timeZone),
    generatedAt: now.toISOString(),
  };
}
