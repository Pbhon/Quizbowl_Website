import "server-only";
import { createHash } from "node:crypto";
import type { Question } from "@/lib/practice";
import type { IdentifierCard } from "@/lib/decks";

export const clueVersion = "clues-v2-simple";
export function clueCacheKey(question: Question, model: string) {
  // Include content, not just upstream IDs: edited upstream questions must miss.
  return createHash("sha256")
    .update(
      JSON.stringify([
        clueVersion,
        model,
        question.type,
        question.id,
        question.leadin,
        question.parts,
        question.answers,
        question.answerLines,
      ]),
    )
    .digest("hex");
}
export function validateClues(
  value: unknown,
  question: Question,
): IdentifierCard[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12)
    throw new Error("Invalid generated clues.");
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.clue !== "string" ||
      !item.clue.trim() ||
      item.clue.length > 1000 ||
      !["simple", "intermediate", "complex"].includes(item.complexity) ||
      !Number.isInteger(item.part) ||
      item.part < 0 ||
      item.part >= question.parts.length ||
      typeof item.sourceExcerpt !== "string" ||
      !item.sourceExcerpt.trim() ||
      item.sourceExcerpt.length > 2000 ||
      !question.parts[item.part].includes(item.sourceExcerpt)
    )
      throw new Error("Invalid generated clues.");
    const clue = item.clue.trim();
    const id = createHash("sha256")
      .update(JSON.stringify([item.part, clue]))
      .digest("hex")
      .slice(0, 24);
    if (seen.has(id)) throw new Error("Duplicate generated clue.");
    seen.add(id);
    // Never accept a model-provided answer. Exports bind part to official answers.
    return {
      id,
      clue,
      part: item.part,
      complexity: item.complexity,
      sourceExcerpt: item.sourceExcerpt,
    };
  });
}
