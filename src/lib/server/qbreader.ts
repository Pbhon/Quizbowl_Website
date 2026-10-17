import "server-only";
import { createHash } from "node:crypto";
const cache = new Map<
  string,
  { expires: number; data: Record<string, unknown> }
>();
const pending = new Map<string, Promise<Record<string, unknown>>>();
export async function qbreader(
  endpoint: string,
  params: URLSearchParams,
): Promise<Record<string, unknown>> {
  if (
    !["check-answer", "query", "random-tossup", "random-bonus"].includes(
      endpoint,
    )
  )
    throw new Error("Invalid QBReader endpoint.");
  // Random retrieval stays random. Deterministic answer checks can be reused
  // briefly; store only hashes of answer inputs, never their plaintext.
  if (endpoint !== "check-answer") return upstream(endpoint, params);
  const key = createHash("sha256").update(params.toString()).digest("hex");
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now())
    return structuredClone(cached.data);
  const active = pending.get(key);
  if (active) return structuredClone(await active);
  // A bounded pending map avoids a burst retaining unbounded request state.
  if (pending.size >= 500)
    throw new Error("Answer checking is busy. Please retry.");
  const promise = upstream(endpoint, params);
  pending.set(key, promise);
  try {
    const data = await promise;
    if (["accept", "reject", "prompt"].includes(String(data.directive))) {
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(key, {
        expires: Date.now() + 60000,
        data: structuredClone(data),
      });
    }
    return data;
  } finally {
    pending.delete(key);
  }
}
async function upstream(
  endpoint: string,
  params: URLSearchParams,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://www.qbreader.org/api/${endpoint}?${params}`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "QBReader is busy. Please wait a moment and retry."
        : "QBReader is unavailable. Please retry.",
    );
  return response.json();
}
