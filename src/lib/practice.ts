export type Question = {
  id: string;
  type: "tossup" | "bonus";
  category: string;
  subcategory: string;
  difficulty: number;
  source: string;
  leadin: string;
  parts: string[];
  answers: string[];
  answerLines: string[];
  formattedParts?: string[];
  formattedLeadin?: string;
};
export type Outcome = "correct" | "incorrect" | "skipped";
export type Attempt = {
  questionId: string;
  part: number;
  answer: string;
  outcome: Outcome;
};
export const subjects: Record<string, string[]> = {
  Literature: [
    "American Literature",
    "British Literature",
    "European Literature",
    "World Literature",
    "Other Literature",
  ],
  History: [
    "American History",
    "European History",
    "World History",
    "Other History",
  ],
  Science: ["Biology", "Chemistry", "Physics", "Other Science"],
  "Fine Arts": ["Visual Fine Arts", "Auditory Fine Arts", "Other Fine Arts"],
  Religion: ["Religion"],
  Mythology: ["Mythology"],
  Philosophy: ["Philosophy"],
  "Social Science": ["Social Science"],
  Geography: ["Geography"],
  "Current Events": ["Current Events"],
  "Other Academic": ["Other Academic"],
  Trash: [
    "Movies",
    "Music",
    "Sports",
    "Television",
    "Video Games",
    "Other Trash",
  ],
};
// Prefer QBReader's unformatted fields for display; keep HTML answerlines for judging.
export function normalizeQuestion(
  raw: Record<string, unknown>,
  type: Question["type"],
): Question | null {
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((v) => typeof v === "string");
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const parts =
    type === "tossup"
      ? [
          text(raw.question_sanitized) ||
            text(raw.question).replace(/<[^>]*>/g, ""),
        ]
      : raw.parts_sanitized;
  const answers = type === "tossup" ? [raw.answer] : raw.answers;
  const lines =
    type === "tossup"
      ? [text(raw.answer_sanitized) || text(raw.answer).replace(/<[^>]*>/g, "")]
      : raw.answers_sanitized;
  if (
    !text(raw._id) ||
    !strings(parts) ||
    !parts.length ||
    !strings(answers) ||
    !strings(lines) ||
    parts.length !== answers.length ||
    parts.length !== lines.length ||
    parts.some((p) => !p.trim()) ||
    answers.some((a) => !a.trim())
  )
    return null;
  const set = raw.set as { name?: string } | undefined;
  const packet = raw.packet as { name?: string } | undefined;
  return {
    id: text(raw._id),
    type,
    category: text(raw.category),
    subcategory: text(raw.subcategory),
    difficulty: Number(raw.difficulty),
    source: [set?.name, packet?.name].filter(Boolean).join(" · "),
    leadin: text(raw.leadin_sanitized),
    parts,
    answers,
    answerLines: lines,
    ...(type === "tossup" && text(raw.question)
      ? { formattedParts: [text(raw.question)] }
      : {}),
    ...(type === "bonus" &&
    strings(raw.parts) &&
    raw.parts.length === parts.length
      ? { formattedParts: raw.parts }
      : {}),
    ...(text(raw.leadin) ? { formattedLeadin: text(raw.leadin) } : {}),
  };
}
