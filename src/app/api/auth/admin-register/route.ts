import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import { readSignupBody, validAdminCode } from "@/lib/server/admin-signup";
import { defaultPreferences } from "@/lib/accounts";

import { siteTeam } from "@/lib/server/site-team";

export const runtime = "nodejs";
function reply(message: string, status: number) {
  return Response.json(
    { message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      // Next.js can normalize request.url to localhost during development.
      // The HTTP Host header preserves the browser's actual destination.
      const parsed = new URL(origin);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.host !== request.headers.get("host")
      )
        return reply("This request is not allowed.", 403);
    } catch {
      return reply("This request is not allowed.", 403);
    }
  }
  if (
    !process.env.ADMIN_SIGNUP_CODE ||
    process.env.ADMIN_SIGNUP_CODE.length < 16
  )
    return reply(
      "Admin registration is not configured. Contact your project administrator.",
      503,
    );
  let body: Record<string, unknown>;
  try {
    body = await readSignupBody(request);
  } catch {
    return reply("Enter valid account details.", 400);
  }
  // Validate the secret before any account or database write.
  if (!validAdminCode(body.code))
    return reply("The administrator code is incorrect.", 403);
  const { email, password, name } = body;
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^ @]+@[^ @]+\.[^ @]+$/.test(email.trim()) ||
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 128 ||
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 80
  )
    return reply(
      "Enter a name, valid email, and password of 8–128 characters.",
      400,
    );
  let teamId: string;
  try {
    teamId = siteTeam().id;
  } catch {
    return reply(
      "Admin team access is not configured. Contact your project administrator.",
      503,
    );
  }
  let uid: string | undefined;
  try {
    const { auth, db } = getFirebaseAdmin();
    // A durable, transaction-protected limit also works across server instances.
    const limit = db.doc("adminSignupLimits/" + teamId);
    const now = Date.now();
    const allowed = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(limit);
      const previous = snapshot.data();
      const active = previous && previous.windowEnd > now;
      const count = active ? previous.count : 0;
      if (count >= 10) return false;
      transaction.set(limit, {
        count: count + 1,
        windowEnd: active ? previous.windowEnd : now + 3600000,
      });
      return true;
    });
    if (!allowed)
      return reply(
        "Admin registration has reached its hourly limit. Try again later.",
        429,
      );
    // Keep the new account disabled until its role and private profile are saved.
    const account = await auth.createUser({
      email: email.trim().toLowerCase(),
      password,
      displayName: name.trim(),
      disabled: true,
    });
    uid = account.uid;
    const batch = db.batch();
    batch.create(db.doc("staff/" + uid), { role: "admin", teamId });
    batch.create(db.doc("users/" + uid), {
      displayName: name.trim(),
      bio: "",
      grade: "",
      preferences: defaultPreferences,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    await auth.updateUser(uid, { disabled: false });
    return reply(
      "Administrator account created. Sign in and verify your email to use team tools.",
      201,
    );
  } catch (cause) {
    if (uid) {
      try {
        const { auth, db } = getFirebaseAdmin();
        const batch = db.batch();
        batch.delete(db.doc("staff/" + uid));
        batch.delete(db.doc("users/" + uid));
        await batch.commit();
        await auth.deleteUser(uid);
      } catch {
        console.error(
          "Admin signup cleanup failed; inspect account setup for UID:",
          uid,
        );
      }
    }
    const code = (cause as { code?: string }).code;
    if (code === "auth/email-already-exists")
      return reply(
        "Unable to create this account. Try signing in or resetting your password.",
        409,
      );
    console.error("Admin signup failed:", code || "server-configuration");
    return reply(
      "Admin registration is temporarily unavailable. Please try again later.",
      503,
    );
  }
}
