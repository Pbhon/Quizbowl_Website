import type { User } from "firebase/auth";

/** Generation is an explicit saved-question action, never a reader side effect. */
export async function requestClues(user: User, deckId: string, cardId: string) {
  const response = await fetch("/api/ai/clues", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ deckId, cardId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Clue generation failed.");
  return data;
}

export async function editSavedClue(user: User, body: Record<string, unknown>) {
  const response = await fetch("/api/decks", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Clue changes could not be saved.");
  return data;
}
