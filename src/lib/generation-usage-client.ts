import type { User } from "firebase/auth";
import type { GenerationUsage } from "./clues";

type Snapshot = { usage: GenerationUsage | null; error: string | null };
const initial: Snapshot = { usage: null, error: null };
const stores = new WeakMap<User, ReturnType<typeof createUsageStore>>();

// Every visible generation control for one account shares a single read and timer.
function createUsageStore(user: User) {
  let snapshot = initial;
  let pending: Promise<void> | null = null;
  let queued = false;
  let lastRead = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  let reset: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  function publish(next: Snapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  function scheduleReset() {
    clearTimeout(reset);
    if (
      listeners.size &&
      snapshot.usage &&
      snapshot.usage.resetsAt > Date.now()
    )
      reset = setTimeout(
        () => void refresh(),
        snapshot.usage.resetsAt - Date.now() + 100,
      );
  }
  function refresh(afterAttempt = false): Promise<void> {
    if (pending) {
      // A pre-attempt read may finish after the provider attempt. Read again so
      // its older count cannot leave the counter stale.
      queued ||= afterAttempt;
      return pending;
    }
    lastRead = Date.now();
    pending = (async () => {
      try {
        const response = await fetch("/api/ai/usage", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error("AI usage could not be refreshed.");
        publish({ usage: data.usage, error: null });
      } catch {
        publish({
          ...snapshot,
          error: "AI usage could not be refreshed. Please retry.",
        });
      } finally {
        pending = null;
        scheduleReset();
        if (queued) {
          queued = false;
          void refresh();
        }
      }
    })();
    return pending;
  }
  function onFocus() {
    if (document.visibilityState === "visible" && Date.now() - lastRead > 1000)
      void refresh();
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        void refresh();
        interval = setInterval(onFocus, 60000);
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onFocus);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearInterval(interval);
          clearTimeout(reset);
          window.removeEventListener("focus", onFocus);
          document.removeEventListener("visibilitychange", onFocus);
        }
      };
    },
  };
}

export function generationUsageStore(user: User) {
  let store = stores.get(user);
  if (!store) {
    store = createUsageStore(user);
    stores.set(user, store);
  }
  return store;
}

export async function refreshGenerationUsage(user: User) {
  await stores.get(user)?.refresh(true);
}
