import type { Question, Outcome } from "./practice";

export type HistoryAttempt = {
  id: string;
  question: Question;
  part: number;
  outcome: Outcome | "prompt";
  submittedAnswer: string;
  createdAt: string | null;
  submissions: {
    answer: string;
    directive: string;
    directedPrompt: string | null;
    submittedAt: string;
  }[];
};
export type HistoryFilters = {
  category: string;
  subcategory: string;
  difficulty: string;
  outcome: string;
};
export type HistoryPage = {
  attempts: HistoryAttempt[];
  nextCursor: string | null;
};
export type SavedDeck = { id: string; name: string; questions: Question[] };
export function matchesHistory(
  attempt: HistoryAttempt,
  filters: HistoryFilters,
) {
  return (
    (!filters.category || attempt.question.category === filters.category) &&
    (!filters.subcategory ||
      attempt.question.subcategory === filters.subcategory) &&
    (!filters.difficulty ||
      attempt.question.difficulty === Number(filters.difficulty)) &&
    (!filters.outcome || attempt.outcome === filters.outcome)
  );
}
