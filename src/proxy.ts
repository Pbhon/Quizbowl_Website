import { NextResponse, type NextRequest } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import {
  ApiLimitError,
  enforceApiLimit,
  assertRequestSize,
} from "@/lib/server/api-policy";

const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};
export async function proxy(request: NextRequest) {
  try {
    await assertRequestSize(request);
    const origin = request.headers.get("origin");
    if (origin) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new ApiLimitError(403, "This request is not allowed.");
      }
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.host !== request.headers.get("host")
      )
        throw new ApiLimitError(403, "This request is not allowed.");
    }
    const { db, auth } = getFirebaseAdmin();
    const authorization = request.headers.get("authorization");
    let uid: string | null = null;
    if (authorization) {
      const token = authorization.match(/^Bearer (\S+)$/)?.[1];
      if (!token) throw new ApiLimitError(401, "Sign in again.");
      try {
        uid = (await auth.verifyIdToken(token, true)).uid;
      } catch {
        throw new ApiLimitError(401, "Sign in again.");
      }
    }
    await enforceApiLimit(db, uid, request.nextUrl.pathname);
    return NextResponse.next({ headers });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ApiLimitError
            ? error.message
            : "The service is unavailable. Please retry.",
        message:
          error instanceof ApiLimitError
            ? error.message
            : "The service is unavailable. Please retry.",
      },
      {
        status: error instanceof ApiLimitError ? error.status : 503,
        headers: {
          ...headers,
          ...(error instanceof ApiLimitError && error.retryAfter
            ? { "Retry-After": String(error.retryAfter) }
            : {}),
        },
      },
    );
  }
}
export const config = { matcher: "/api/:path*" };
