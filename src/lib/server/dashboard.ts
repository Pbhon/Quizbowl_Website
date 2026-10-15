import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import {
  buildStatistics,
  eligibleUpcoming,
  type RecentSession,
  type StatisticAttempt,
  type Upcoming,
} from "@/lib/statistics";
import { siteTeam } from "./site-team";

export function timestampISO(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  )
    return value.toDate().toISOString();
  if (typeof value === "string" && Number.isFinite(new Date(value).getTime()))
    return new Date(value).toISOString();
  return null;
}
export async function loadDashboard(
  db: Firestore,
  uid: string,
  timeZone: string,
  now = new Date(),
) {
  const root = db.doc(`users/${uid}`);
  const teamId = siteTeam().id;
  const [attempts, sessions, membership] = await Promise.all([
    root.collection("attempts").get(),
    root
      .collection("practiceSessions")
      .orderBy("createdAt", "desc")
      .limit(8)
      .get(),
    db.doc(`teams/${teamId}/members/${uid}`).get(),
  ]);
  const upcoming: Upcoming[] = [];
  if (membership.exists) {
    const records = await Promise.all([
      db.collection(`teams/${teamId}/assignments`).get(),
      db.collection(`teams/${teamId}/events`).get(),
    ]);
    records.forEach((snapshot, index) =>
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const kind =
          index === 0
            ? "assignment"
            : data.type === "competition"
              ? "competition"
              : data.type === "practice"
                ? "practice"
                : "event";
        const field = index === 0 ? "dueAt" : "startsAt";
        data[field] = timestampISO(data[field]);
        if (
          eligibleUpcoming(data, uid, now, field) &&
          typeof data.title === "string"
        )
          upcoming.push({
            id: `${kind}:${doc.id}`,
            title: data.title,
            date: data[field],
            kind,
          });
      }),
    );
  }
  const history = attempts.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      completedAt: timestampISO(data.completedAt),
    } as StatisticAttempt;
  });
  const recent = sessions.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        createdAt: timestampISO(data.createdAt)!,
        questionCount: data.questionCount,
        totalParts: data.totalParts,
        attemptedParts: data.attemptedParts,
        correct: data.correct,
        incorrect: data.incorrect,
        skipped: data.skipped,
        completed: Boolean(data.completedAt),
      } as RecentSession;
    })
    .filter((session) => session.createdAt);
  return {
    ...buildStatistics(history, now, timeZone),
    sessions: recent,
    upcoming: upcoming
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10),
  };
}
