import type { StudyDeck, IdentifierCard } from "./decks";
import { savedIdentifiers } from "./decks";

export type ExportRow = { front: string; back: string; tags: string };
export type ExportOptions = {
  kind?: "questions" | "identifiers";
  category?: string;
  difficulty?: string;
  complexity?: IdentifierCard["complexity"] | "";
};

/** UTF-8 CSV with Anki's import headers; headers are comments, never cards. */
export function ankiCSV(rows: ExportRow[]) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return (
    [
      "#separator:Comma",
      "#html:true",
      "#tags column:3",
      "#columns:Front,Back,Tags",
      ...rows.map((row) =>
        [row.front, row.back, row.tags].map(quote).join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}

export function exportRows(
  deck: StudyDeck,
  options: ExportOptions = {},
): ExportRow[] {
  const cards = deck.cards.filter((card) =>
    (!options.category || card.originalQuestion.category === options.category) &&
    (!options.difficulty || String(card.originalQuestion.difficulty) === options.difficulty),
  );
  if (options.kind === "identifiers")
    return cards.flatMap((card) =>
      savedIdentifiers(card.identifiers, card.originalQuestion).filter((identifier) => !options.complexity || identifier.complexity === options.complexity).map(
        (identifier) => ({
          front: identifier.clue,
          back: `${card.originalQuestion.answerLines[identifier.part]}\n\nSource excerpt: ${identifier.sourceExcerpt}`,
          tags: "",
        }),
      ),
    );
  return cards.map((card) => ({
    front: [card.question.leadin, ...card.question.parts]
      .filter(Boolean)
      .join("\n\n"),
    back: card.originalQuestion.answerLines.join("\n\n"),
    tags: "",
  }));
}
