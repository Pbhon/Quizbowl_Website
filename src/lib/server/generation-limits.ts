import "server-only";
import { PracticeError } from "./practice-persistence";

export function generationLimits() {
  function limit(name: string, fallback: number, maximum: number) {
    const raw = process.env[name];
    if (!raw) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > maximum)
      throw new PracticeError(
        "Generation limits are not configured correctly.",
        503,
      );
    return Number(raw);
  }
  return {
    student: limit("GEMINI_STUDENT_DAILY_LIMIT", 20, 20),
    daily: limit("GEMINI_DEPLOYMENT_DAILY_LIMIT", 400, 1000),
    minute: limit("GEMINI_DEPLOYMENT_MINUTE_LIMIT", 10, 60),
  };
}
