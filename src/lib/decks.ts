import type { Question } from "./practice";

export type IdentifierCard = {
  id?: string;
  clue: string;
  complexity: "simple" | "intermediate" | "complex";
  part: number;
  sourceExcerpt: string;
};
/** Read saved generation results only; exporting never generates clues. */
export function savedIdentifiers(
  value: unknown,
  question: Question,
): IdentifierCard[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is IdentifierCard =>
        item &&
        typeof item.clue === "string" &&
        item.clue.trim() &&
        ["simple", "intermediate", "complex"].includes(item.complexity) &&
        Number.isInteger(item.part) &&
        item.part >= 0 &&
        item.part < question.answerLines.length &&
        typeof item.sourceExcerpt === "string" &&
        item.sourceExcerpt.trim(),
    )
    .map(({ id, clue, complexity, part, sourceExcerpt }) => ({
      ...(typeof id === "string" && id.trim() ? { id: id.trim() } : {}),
      clue,
      complexity,
      part,
      sourceExcerpt,
    }));
}
export type SavedCard = {
  id: string;
  question: Question;
  originalQuestion: Question;
  tags: string[];
  notes: string;
  identifiers?: IdentifierCard[];
};
export type StudyDeck = {
  id: string;
  canEdit: boolean;
  sharedId: string | null;
  visibility: "private" | "team";
  teamName: string;
  name: string;
  description: string;
  tags: string[];
  cards: SavedCard[];
  questions: Question[];
};
export function matchesCard(card: SavedCard, search: string) {
  return [
    card.question.leadin,
    ...card.question.parts,
    ...card.question.answerLines,
    card.question.category,
    card.question.subcategory,
    card.question.source,
    ...card.tags,
    card.notes,
  ]
    .join(" ")
    .toLowerCase()
    .includes(search.trim().toLowerCase());
}
