import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import { siteTeam } from "@/lib/server/site-team";

export const runtime = "nodejs";
function reply(body: object, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return reply({ message: "Sign in to join your school." }, 401);
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.host !== request.headers.get("host")
      )
        return reply({ message: "This request is not allowed." }, 403);
    } catch {
      return reply({ message: "This request is not allowed." }, 403);
    }
  }
  try {
    const team = siteTeam();
    const { auth, db } = getFirebaseAdmin();
    let account;
    try {
      account = await auth.verifyIdToken(token, true);
    } catch {
      return reply({ message: "Your session expired. Sign in again." }, 401);
    }
    const member = db.doc(`teams/${team.id}/members/${account.uid}`);
    const school = db.doc(`teams/${team.id}`);
    await db.runTransaction(async (transaction) => {
      const [membership, metadata, profile, legacy] = await transaction.getAll(
        member,
        school,
        db.doc(`users/${account.uid}`),
        db.doc(`memberships/${account.uid}`),
      );
      const displayName =
        profile.data()?.displayName || account.name || "QuizBowl student";
      if (!metadata.exists || metadata.data()?.displayName !== team.name)
        transaction.set(
          school,
          { displayName: team.name, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      if (!membership.exists)
        transaction.create(member, {
          displayName,
          joinedAt:
            legacy.data()?.teamId === team.id
              ? legacy.data()?.joinedAt || FieldValue.serverTimestamp()
              : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      else if (membership.data()?.displayName !== displayName)
        transaction.update(member, {
          displayName,
          updatedAt: FieldValue.serverTimestamp(),
        });
    });
    return reply({ teamId: team.id }, 200);
  } catch {
    return reply(
      { message: "Your school workspace could not be loaded. Please retry." },
      503,
    );
  }
}
