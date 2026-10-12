import type { StudyDeck, IdentifierCard, SavedCard } from "./decks";
import { savedIdentifiers } from "./decks";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const ANKI_NOTE_TYPE = "QuizBowl v1";
export type ExportRow = {
  noteId: string;
  front: string;
  back: string;
  tags: string;
};
export function stableNoteId(card: SavedCard, identifier?: IdentifierCard) {
  // Deck/account identity and editable study text do not belong in this key.
  const source = card.originalQuestion;
  const key = identifier
    ? [
        "identifier",
        source.type,
        source.id,
        identifier.part,
        identifier.id || identifier.sourceExcerpt.trim().replace(/\s+/g, " "),
      ]
    : ["question", source.type, source.id];
  return `qb1-${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(key))))}`;
}
function uniqueRows(rows: ExportRow[]) {
  const notes = new Map<string, ExportRow>();
  for (const row of rows) {
    const existing = notes.get(row.noteId);
    if (existing)
      existing.tags = [
        ...new Set([...existing.tags.split(" "), ...row.tags.split(" ")]),
      ]
        .filter(Boolean)
        .sort()
        .join(" ");
    else notes.set(row.noteId, { ...row });
  }
  return [...notes.values()].sort((a, b) =>
    a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0,
  );
}
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
  return [
    ...new Set(
      [
        card.originalQuestion.category &&
          `category::${tag(card.originalQuestion.category)}`,
        card.originalQuestion.subcategory &&
          `subcategory::${tag(card.originalQuestion.subcategory)}`,
        `difficulty::${card.originalQuestion.difficulty}`,
        ...[...deck.tags, ...card.tags]
          .filter((value) => value.trim())
          .map((value) => `topic::${tag(value)}`),
        complexity && `complexity::${complexity}`,
      ].filter(Boolean),
    ),
  ].join(" ");
}
function sourceHTML(card: SavedCard) {
  const question = card.originalQuestion;
  return `<br><br><small>${textHTML([question.category, question.subcategory, `Difficulty ${question.difficulty}`].filter(Boolean).join(" · "))}${question.source ? `<br>Source: ${textHTML(question.source)}` : ""}</small>`;
}

/** UTF-8 CSV with Anki's import headers; headers are comments, never cards. */
export function ankiCSV(rows: ExportRow[]) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return (
    [
      "#separator:Comma",
      "#html:true",
      "#tags column:4",
      "#guid column:5",
      `#notetype:${ANKI_NOTE_TYPE}`,
      "#columns:ID,Front,Back,Tags,GUID",
      ...rows.map((row) =>
        [row.noteId, row.front, row.back, row.tags, row.noteId]
          .map(quote)
          .join(","),
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
    return uniqueRows(
      cards.flatMap((card) =>
        savedIdentifiers(card.identifiers, card.originalQuestion)
          .filter(
            (identifier) =>
              !options.complexity ||
              identifier.complexity === options.complexity,
          )
          .map((identifier) => ({
            noteId: stableNoteId(card, identifier),
            front: textHTML(identifier.clue),
            back: `${formattedHTML(card.originalQuestion.answers[identifier.part] || textHTML(card.originalQuestion.answerLines[identifier.part]))}<br><br>Source excerpt: ${textHTML(identifier.sourceExcerpt)}${sourceHTML(card)}`,
            tags: exportTags(deck, card, identifier.complexity),
          })),
      ),
    );
  return uniqueRows(
    cards.map((card) => ({
      noteId: stableNoteId(card),
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
      back:
        card.originalQuestion.answerLines
          .map((line, i) =>
            card.originalQuestion.answers[i]
              ? formattedHTML(card.originalQuestion.answers[i])
              : textHTML(line),
          )
          .join("<br><br>") + sourceHTML(card),
      tags: exportTags(deck, card),
    })),
  );
}
