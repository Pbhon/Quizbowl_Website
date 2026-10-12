import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

export function validAdminCode(code: unknown) {
  const configured = process.env.ADMIN_SIGNUP_CODE;
  if (
    !configured ||
    configured.length < 16 ||
    typeof code !== "string" ||
    code.length > 256
  )
    return false;
  return timingSafeEqual(
    createHash("sha256").update(configured).digest(),
    createHash("sha256").update(code).digest(),
  );
}

export async function readSignupBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new Error("Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw new Error("Invalid request body.");
  return value;
}
