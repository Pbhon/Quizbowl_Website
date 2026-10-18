"use client";

import { useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { SavedCard } from "@/lib/decks";
import { identifierAnswer } from "@/lib/decks";
import { requestClues } from "@/lib/clue-client";
import { Button } from "./ui/button";
import { Notice } from "./form-field";

export function GeneratedClues({
  user,
  deckId,
  card,
  canEdit,
  refresh,
}: {
  user: User;
  deckId: string;
  card: SavedCard;
  canEdit: boolean;
  refresh: () => void;
}) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await requestClues(user, deckId, card.id);
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please retry.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="AI identifier flashcards">
      {card.identifiers?.map((clue, index) => (
        <article
          key={clue.id || index}
          className="space-y-2 rounded-lg border p-3"
        >
          <p className="whitespace-pre-wrap break-words">{clue.clue}</p>
          <details>
            <summary className="cursor-pointer text-sm">
              Reveal official answer
            </summary>
            <p className="whitespace-pre-wrap break-words">
              {identifierAnswer(card, clue)}
            </p>
          </details>
          <details>
            <summary className="cursor-pointer text-sm">
              Verify source excerpt
            </summary>
            <blockquote className="border-l-2 pl-3 whitespace-pre-wrap break-words">
              {clue.sourceExcerpt}
            </blockquote>
            <p className="text-xs text-muted-foreground">
              Part {clue.part + 1} ·{" "}
              {card.originalQuestion.source || "QBReader database"}
            </p>
          </details>
        </article>
      ))}
      <p className="text-sm">
        AI identifier flashcards are optional. Generation sends this saved
        question and its official answers to Gemini. Check every clue before
        studying.
      </p>
      {canEdit && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void generate()}
        >
          {busy ? "Generating clues…" : "Generate AI clues"}
        </Button>
      )}
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}
