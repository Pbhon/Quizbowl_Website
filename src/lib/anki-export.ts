import type { StudyDeck, IdentifierCard, SavedCard } from "./decks";
import { savedIdentifiers } from "./decks";

export type ExportRow = { front: string; back: string; tags: string };
export type ExportOptions = {
  kind?: "questions" | "identifiers";
  category?: string;
  difficulty?: string;
  complexity?: IdentifierCard["complexity"] | "";
};

export function textHTML(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replace(/\r?\n/g, "<br>");
}
/** Retain basic QBReader emphasis, removing attributes and escaping other markup. */
export function formattedHTML(html: string) {
  return html
    .split(/(<[^>]*>)/g)
    .map((token) => {
      if (!token.startsWith("<")) return token.replace(/\r?\n/g, "<br>");
      const tag = token.match(
        /^<(\/?)(b|strong|i|em|u|sub|sup|br|p)(?:\s[^>]*)?\s*\/?>$/i,
      );
      return tag ? `<${tag[1]}${tag[2].toLowerCase()}>` : textHTML(token);
    })
    .join("");
}

function exportTags(deck: StudyDeck, card: SavedCard, complexity?: string) {
  const tag = (value: string) => encodeURIComponent(value.trim());
  return [...new Set([
    card.originalQuestion.category && `category::${tag(card.originalQuestion.category)}`,
    card.originalQuestion.subcategory && `subcategory::${tag(card.originalQuestion.subcategory)}`,
    `difficulty::${card.originalQuestion.difficulty}`,
    ...[...deck.tags, ...card.tags].filter((value) => value.trim()).map((value) => `topic::${tag(value)}`),
    complexity && `complexity::${complexity}`,
  ].filter(Boolean))].join(" ");
}

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
  const cards = deck.cards.filter(
    (card) =>
      (!options.category ||
        card.originalQuestion.category === options.category) &&
      (!options.difficulty ||
        String(card.originalQuestion.difficulty) === options.difficulty),
  );
  if (options.kind === "identifiers")
    return cards.flatMap((card) =>
      savedIdentifiers(card.identifiers, card.originalQuestion)
        .filter(
          (identifier) =>
            !options.complexity || identifier.complexity === options.complexity,
        )
        .map((identifier) => ({
          front: textHTML(identifier.clue),
          back: `${formattedHTML(card.originalQuestion.answers[identifier.part] || textHTML(card.originalQuestion.answerLines[identifier.part]))}<br><br>Source excerpt: ${textHTML(identifier.sourceExcerpt)}`,
            tags: exportTags(deck, card, identifier.complexity),
        })),
    );
  return cards.map((card) => ({
    front: [
      card.question.leadin
        ? card.question.leadin === card.originalQuestion.leadin &&
          card.originalQuestion.formattedLeadin
          ? formattedHTML(card.originalQuestion.formattedLeadin)
          : textHTML(card.question.leadin)
        : "",
      ...card.question.parts.map((part, i) =>
        part === card.originalQuestion.parts[i] &&
        card.originalQuestion.formattedParts?.[i]
          ? formattedHTML(card.originalQuestion.formattedParts[i])
          : textHTML(part),
      ),
    ]
      .filter(Boolean)
      .join("<br><br>"),
    back: card.originalQuestion.answerLines
      .map((line, i) =>
        card.originalQuestion.answers[i]
          ? formattedHTML(card.originalQuestion.answers[i])
          : textHTML(line),
      )
      .join("<br><br>"),
    tags: exportTags(deck, card),
  }));
}
