export type GenerationState = {
  status: "pending" | "generating" | "completed" | "failed";
  retryAt?: number;
};

/** Whitelist public status fields; fencing tokens and provider details stay private. */
export function generationState(value: unknown): GenerationState {
  const data = value as Record<string, unknown> | undefined;
  if (
    !data ||
    !["pending", "generating", "completed", "failed"].includes(
      String(data.status),
    )
  )
    return { status: "pending" };
  if (
    data.status === "generating" &&
    typeof data.leaseUntil === "number" &&
    data.leaseUntil <= Date.now()
  )
    return { status: "failed" };
  return {
    status: data.status as GenerationState["status"],
    ...(typeof data.retryAt === "number" ? { retryAt: data.retryAt } : {}),
  };
}
