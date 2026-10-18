import type { User } from "firebase/auth";
import type { GenerationState } from "./clues";

export class ClueRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAt?: number,
    public generation?: GenerationState,
  ) {
    super(message);
  }
}

export async function checkClueStatus(
  user: User,
  deckId: string,
  cardId: string,
) {
  const response = await fetch(
    `/api/ai/clues?${new URLSearchParams({ deckId, cardId })}`,
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Generation status is unavailable.");
  return data;
}

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
  if (!response.ok)
    throw new ClueRequestError(
      data.error || "Clue generation failed.",
      response.status,
      data.retryAt,
      data.generation,
    );
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
