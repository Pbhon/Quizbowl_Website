import type { StudyDeck } from "./decks";

export type ExportRow = { front: string; back: string; tags: string };
export type ExportOptions = { kind?: "questions" | "identifiers" };

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

export function exportRows(deck: StudyDeck, options: ExportOptions = {}): ExportRow[] {
  if (options.kind === "identifiers") return [];
  return deck.cards.map((card) => ({
    front: [card.question.leadin, ...card.question.parts]
      .filter(Boolean)
      .join("\n\n"),
    back: card.originalQuestion.answerLines.join("\n\n"),
    tags: "",
  }));
}
