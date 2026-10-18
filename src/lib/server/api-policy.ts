import "server-only";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

export class ApiLimitError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
export async function assertRequestSize(
  request: Request,
  maxBytes = 2 * 1024 * 1024,
) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw new ApiLimitError(413, "Request too large.");
  const reader = request.clone().body?.getReader();
  if (!reader) return;
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new ApiLimitError(413, "Request too large.");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
export function apiBucket(path: string, anonymous: boolean) {
  if (path === "/api/account/data") return { name: "account-data", limit: 3 };
  if (path === "/api/decks/export") return { name: "export", limit: 6 };
  if (path === "/api/ai/usage") return { name: "ai-usage", limit: 60 };
  if (path.startsWith("/api/ai/")) return { name: "ai", limit: 10 };
  if (path === "/api/auth/admin-register") return { name: "signup", limit: 20 };
  if (path === "/api/practice/questions")
    return { name: "questions", limit: anonymous ? 20 : 30 };
  if (
    path === "/api/practice/attempts" ||
    path === "/api/practice/check-answer"
  )
    return { name: "answers", limit: anonymous ? 60 : 180 };
  return { name: "general", limit: anonymous ? 30 : 120 };
}
export async function enforceApiLimit(
  db: Firestore,
  uid: string | null,
  path: string,
  now = Date.now(),
) {
  const bucket = apiBucket(path, !uid);
  const window = Math.floor(now / 60000);
  // Never trust spoofable forwarding headers, or retain raw tokens/IP addresses.
  const key = createHash("sha256")
    .update(JSON.stringify([uid || "anonymous", bucket.name, window]))
    .digest("hex");
  const ref = db.doc(`apiRateLimits/${key}`);
  await db.runTransaction(async (tx) => {
    const count = (await tx.get(ref)).data()?.count || 0;
    if (count >= bucket.limit)
      throw new ApiLimitError(
        429,
        "Too many requests. Please wait and retry.",
        Math.max(1, 60 - (Math.floor(now / 1000) % 60)),
      );
    tx.set(ref, {
      count: count + 1,
      expiresAt: new Date((window + 10) * 60000),
    });
  });
}
