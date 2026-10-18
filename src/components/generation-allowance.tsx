"use client";

import { useSyncExternalStore } from "react";
import type { User } from "firebase/auth";
import { generationUsageStore } from "@/lib/generation-usage-client";
import { Button } from "./ui/button";

export function GenerationAllowance({ user }: { user: User }) {
  const store = generationUsageStore(user);
  const { usage, error } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  return (
    <div
      className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm"
      aria-label="Daily AI usage"
    >
      <p role="status" aria-live="polite">
        {usage
          ? `AI generations today: ${usage.used} / ${usage.limit} used · ${usage.remaining} remaining`
          : "Loading daily AI allowance…"}
      </p>
      {usage && (
        <>
          <p className="text-xs text-muted-foreground">
            Resets {new Date(usage.resetsAt).toLocaleString()} (midnight UTC).
            Cached clues are free; failed generation attempts count. The team
            also shares a daily limit.
          </p>
          {usage.remaining === 0 && (
            <p>
              Your daily limit is reached. You can still use cached clues; new
              generation resumes after the reset.
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <Button variant="ghost" size="sm" onClick={() => void store.refresh()}>
        Refresh AI allowance
      </Button>
    </div>
  );
}
