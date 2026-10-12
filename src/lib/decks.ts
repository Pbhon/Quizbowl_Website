import type { Question } from "./practice";

export type SavedCard = {
  id: string;
  question: Question;
  originalQuestion: Question;
  tags: string[];
  notes: string;
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
