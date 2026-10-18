"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { SavedCard, IdentifierCard } from "@/lib/decks";
import { identifierAnswer, complexityLabels } from "@/lib/decks";
import {
  requestClues,
  editSavedClue,
  checkClueStatus,
  ClueRequestError,
} from "@/lib/clue-client";
import type { GenerationState, GenerationUsage } from "@/lib/clues";
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
  const [complexity, setComplexity] = useState("all");
  const [now, setNow] = useState(0);
  const [usage, setUsage] = useState<GenerationUsage | null>(null);
  const [state, setState] = useState<GenerationState>(
    card.generation || {
      status: card.identifiers?.length ? "completed" : "pending",
    },
  );
  useEffect(() => {
    if (!state.retryAt) return;
    const retryAt = state.retryAt;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [state.retryAt]);
  async function checkStatus() {
    setError("");
    try {
      const result = await checkClueStatus(user, deckId, card.id);
      setState(result.generation);
      setUsage(result.usage);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please retry.");
    }
  }
  async function generate() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setState({ status: "generating" });
    setError("");
    try {
      await requestClues(user, deckId, card.id);
      setState({ status: "completed" });
      refresh();
    } catch (failure) {
      setState(
        failure instanceof ClueRequestError
          ? {
              status: "failed",
              ...failure.generation,
              retryAt: failure.retryAt,
            }
          : { status: "failed" },
      );
      setError(failure instanceof Error ? failure.message : "Please retry.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="AI identifier flashcards">
      <p role="status" className="text-sm">
        Generation status: {state.status}
        {state.status === "pending" && " — waiting for your request"}
      </p>
      {canEdit && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void checkStatus()}
        >
          Check generation status
        </Button>
      )}
      <label className="block text-sm">
        Clue complexity
        <select
          className="form-select mt-1"
          value={complexity}
          onChange={(event) => setComplexity(event.target.value)}
        >
          <option value="all">All complexities</option>
          {Object.entries(complexityLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {card.identifiers
        ?.filter(
          (clue) => complexity === "all" || clue.complexity === complexity,
        )
        .map((clue, index) => (
          <article
            key={clue.id || index}
            className="space-y-2 rounded-lg border p-3"
          >
            <p className="whitespace-pre-wrap break-words">{clue.clue}</p>
            <span className="badge">{complexityLabels[clue.complexity]}</span>
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
            {canEdit && clue.id && (
              <ClueEditor
                key={JSON.stringify(clue)}
                user={user}
                deckId={deckId}
                cardId={card.id}
                clue={clue}
                refresh={refresh}
              />
            )}
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
          onClick={() => {
            if (!state.retryAt || state.retryAt <= Date.now()) void generate();
          }}
          aria-disabled={Boolean(state.retryAt && state.retryAt > now)}
        >
          {busy ? "Generating clues…" : "Generate AI clues"}
        </Button>
      )}
      {error && <Notice error>{error}</Notice>}
      {usage && (
        <p className="text-sm">
          Daily AI allowance: {usage.remaining} of {usage.limit} requests
          remaining. Resets {new Date(usage.resetsAt).toLocaleString()}. Cached
          clues use no allowance; failed requests count.
        </p>
      )}
      {state.retryAt && state.retryAt > now && (
        <p className="text-sm">
          Retry available after {new Date(state.retryAt).toLocaleTimeString()}.
        </p>
      )}
    </section>
  );
}

function ClueEditor({
  user,
  deckId,
  cardId,
  clue,
  refresh,
}: {
  user: User;
  deckId: string;
  cardId: string;
  clue: IdentifierCard;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [front, setFront] = useState(clue.clue);
  const [complexity, setComplexity] = useState(clue.complexity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await editSavedClue(user, {
        action: "editIdentifier",
        deckId,
        cardId,
        clueId: clue.id,
        expectedClue: clue.clue,
        expectedComplexity: clue.complexity,
        clue: front,
        complexity,
      });
      setOpen(false);
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await editSavedClue(user, {
        action: "removeIdentifier",
        deckId,
        cardId,
        clueId: clue.id,
        expectedClue: clue.clue,
        expectedComplexity: clue.complexity,
      });
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={() => setOpen(!open)}>
        Edit clue
      </Button>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => setRemoving(!removing)}
      >
        Remove clue
      </Button>
      {removing && (
        <div className="space-y-2">
          <p>
            Remove this clue from this deck? Other students’ cards and the
            source question are kept.
          </p>
          <Button disabled={busy} onClick={() => void remove()}>
            Confirm remove clue
          </Button>
          <Button variant="ghost" onClick={() => setRemoving(false)}>
            Cancel removal
          </Button>
        </div>
      )}
      {open && (
        <form className="space-y-2" onSubmit={(event) => void save(event)}>
          <label className="block text-sm">
            Flashcard front
            <textarea
              className="form-select mt-1"
              value={front}
              onChange={(event) => setFront(event.target.value)}
              required
              maxLength={1000}
            />
          </label>
          <label className="block text-sm">
            Edited clue complexity
            <select
              className="form-select mt-1"
              value={complexity}
              onChange={(event) =>
                setComplexity(
                  event.target.value as IdentifierCard["complexity"],
                )
              }
            >
              {Object.entries(complexityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs">
            Your edit applies to this deck. The official answer and source
            excerpt stay attached.
          </p>
          <Button disabled={busy} type="submit">
            Save clue changes
          </Button>
        </form>
      )}
      {error && <Notice error>{error}</Notice>}
    </div>
  );
}
