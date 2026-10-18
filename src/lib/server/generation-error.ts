import "server-only";
import { PracticeError } from "./practice-persistence";
import type { GenerationState } from "@/lib/clues";

export class GenerationError extends PracticeError {
  constructor(
    message: string,
    status: number,
    public retryAt: number,
    public generation?: GenerationState,
  ) {
    super(message, status);
  }
}
