"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useAuth } from "./auth-provider";
import { AccountGuard } from "./account-guard";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";
import { FormField, Notice } from "./form-field";
import { matchesCard, type StudyDeck, type SavedCard } from "@/lib/decks";
import { DeckExport } from "./deck-export";

export async function deckRequest(
  user: User,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/decks", {
    method: body ? "POST" : "GET",
    signal,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Deck request failed. Please retry.");
  return data;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Please retry.";
const tagsFrom = (text: string) =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
type Source =
  | { attemptId: string }
  | { sessionId: string; questionIndexes: number[] }
  | { sourceDeckId: string; cardId: string }
  | { sourceSharedId: string; cardId: string };

export function QuestionDeckActions({
  user,
  source,
  star = false,
}: {
  user: User;
  source: Source;
  star?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [decks, setDecks] = useState<StudyDeck[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    deckRequest(user, undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDecks(data.decks.filter((deck: StudyDeck) => deck.canEdit));
          setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      });
    return () => controller.abort();
  }, [open, user]);
  async function save(starring: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const ids = [...selected];
      if (!starring && name.trim()) {
        const created = await deckRequest(user, { action: "create", name });
        ids.push(created.deckId);
        if (alive.current) {
          setName("");
          setSelected(ids);
          setDecks(null);
        }
      }
      await deckRequest(user, {
        action: starring ? "star" : "save",
        ...source,
        deckIds: ids,
      });
      if (alive.current) {
        setNotice(
          starring
            ? "Saved to Starred Questions."
            : "Question saved to your deck.",
        );
        setOpen(false);
      }
    } catch (failure) {
      if (alive.current) setError(message(failure));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {star && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Star question
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            setError("");
          }}
        >
          Add to deck
        </Button>
      </div>
      {open && (
        <form
          className="max-w-lg space-y-3 rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <p className="text-sm">
            Choose up to eight decks, or create a new deck.
          </p>
          {!decks && !error && <Notice>Loading study decks…</Notice>}
          {decks && (
            <fieldset disabled={busy} className="space-y-2">
              <legend className="sr-only">Study decks</legend>
              {decks.map((deck) => (
                <label
                  key={deck.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(deck.id)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, deck.id]
                          : selected.filter((id) => id !== deck.id),
                      )
                    }
                  />
                  {deck.name}
                </label>
              ))}
              <FormField
                id={`new-deck-${"attemptId" in source ? source.attemptId : "cardId" in source ? source.cardId : source.questionIndexes.join("-")}`}
                label="New deck name"
              >
                <Input
                  id={`new-deck-${"attemptId" in source ? source.attemptId : "cardId" in source ? source.cardId : source.questionIndexes.join("-")}`}
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>
              <Button
                type="submit"
                disabled={
                  busy ||
                  (!selected.length && !name.trim()) ||
                  selected.length + (name.trim() ? 1 : 0) > 8
                }
              >
                {busy ? "Saving…" : "Save question"}
              </Button>
            </fieldset>
          )}
        </form>
      )}
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
    </div>
  );
}

export function StudyDecks({
  teacherCurated = false,
}: {
  teacherCurated?: boolean;
}) {
  const { user } = useAuth();
  return (
    <AccountGuard staff={teacherCurated}>
      {user && (
        <DeckWorkspace
          key={user.uid}
          user={user}
          teacherCurated={teacherCurated}
        />
      )}
    </AccountGuard>
  );
}
function DeckWorkspace({
  user,
  teacherCurated,
}: {
  user: User;
  teacherCurated: boolean;
}) {
  const [decks, setDecks] = useState<StudyDeck[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] =
    useState<StudyDeck["visibility"]>("private");
  useEffect(() => {
    const controller = new AbortController();
    deckRequest(user, undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDecks(data.decks);
          setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      });
    return () => controller.abort();
  }, [user, revision]);
  const refresh = () => setRevision((n) => n + 1);
  const visibleDecks = decks?.filter(
    (deck) =>
      deck.visibility === visibility &&
      (!teacherCurated || (deck.teacherCurated && deck.canEdit)),
  );
  return (
    <div className="space-y-6">
      <CreateDeck
        user={user}
        refresh={refresh}
        teacherCurated={teacherCurated}
      />
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" asChild>
          <Link href="/history">Save questions from history</Link>
        </Button>
        <Button variant="outline" onClick={refresh}>
          Refresh decks
        </Button>
      </div>
      <FormField
        id="deck-list-visibility"
        label="Show decks"
        hint="Public decks are shared with your team."
      >
        <select
          id="deck-list-visibility"
          className="form-select"
          value={visibility}
          onChange={(event) =>
            setVisibility(event.target.value as StudyDeck["visibility"])
          }
        >
          <option value="private">Private decks</option>
          <option value="team">Public decks</option>
        </select>
      </FormField>
      <FormField
        id="search-cards"
        label="Search saved cards"
        hint="Search questions, answers, subjects, notes, and topic tags."
      >
        <Input
          id="search-cards"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </FormField>
      {error && <Notice error>{error}</Notice>}
      {!decks && !error && <Notice>Loading your decks…</Notice>}
      {visibleDecks?.length === 0 && (
        <Notice>
          {visibility === "private"
            ? "No private decks yet. Create a private deck to get started."
            : "No public decks are shared with your team yet."}
        </Notice>
      )}
      {visibleDecks?.map((deck) => (
        <DeckPanel
          key={deck.id}
          deck={deck}
          user={user}
          search={search}
          refresh={refresh}
        />
      ))}
    </div>
  );
}
function CreateDeck({
  user,
  refresh,
  teacherCurated,
}: {
  user: User;
  refresh: () => void;
  teacherCurated: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [topic, setTopic] = useState("");
  const [type, setType] = useState("tossup");
  const [count, setCount] = useState(10);
  const [visibility, setVisibility] =
    useState<StudyDeck["visibility"]>("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingDeck = useRef<string | null>(null),
    lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let session: { sessionId: string; questions: unknown[] } | null = null;
      if (topic.trim()) {
        const response = await fetch("/api/practice/questions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await user.getIdToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type,
            count,
            topic,
            difficulty: "",
            category: "",
            subcategory: "",
            excluded: [],
          }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Topic questions could not be loaded.");
        if (!data.questions.length)
          throw new Error(
            "No questions match this topic. Try a broader topic.",
          );
        session = data;
      }
      const id =
        pendingDeck.current ||
        (
          await deckRequest(user, {
            action: "create",
            teacherCurated,
            name,
            description,
            tags: tagsFrom(tags),
            visibility,
          })
        ).deckId;
      pendingDeck.current = id;
      if (session)
        await deckRequest(user, {
          action: "save",
          deckIds: [id],
          sessionId: session.sessionId,
          questionIndexes: session.questions.map((_, index) => index),
        });
      pendingDeck.current = null;
      if (alive.current) {
        setNotice(
          session
            ? `Deck created with ${session.questions.length} original questions.`
            : "Deck created. Add questions from practice or history.",
        );
        setName("");
        setDescription("");
        setTags("");
        setTopic("");
        setVisibility("private");
        refresh();
      }
    } catch (failure) {
      if (alive.current) {
        setError(message(failure));
        refresh();
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-xl font-semibold">Create a study deck</h2>
        <form onSubmit={create} className="space-y-4">
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            {!teacherCurated && (
              <VisibilityField
                id="create-visibility"
                value={visibility}
                onChange={setVisibility}
              />
            )}
            <FormField id="create-name" label="Deck name">
              <Input
                id="create-name"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <FormField
              id="create-tags"
              label="Topic tags"
              hint="Comma-separated, up to 20 tags."
            >
              <Input
                id="create-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </FormField>
            <FormField id="create-description" label="Deck description">
              <Input
                id="create-description"
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
            <FormField
              id="create-topic"
              label="Populate from a topic"
              hint="Optional. Search QBReader for original questions."
            >
              <Input
                id="create-topic"
                maxLength={200}
                placeholder="e.g. photosynthesis"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </FormField>
            {topic.trim() && (
              <>
                <FormField id="create-type" label="Question type">
                  <select
                    id="create-type"
                    className="form-select"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option value="tossup">Tossups</option>
                    <option value="bonus">Bonuses</option>
                  </select>
                </FormField>
                <FormField id="create-count" label="Number of questions">
                  <Input
                    id="create-count"
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                </FormField>
              </>
            )}
          </fieldset>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create deck"}
          </Button>
        </form>
        {error && <Notice error>{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
      </CardContent>
    </Card>
  );
}
function DeckPanel({
  deck,
  user,
  search,
  refresh,
}: {
  deck: StudyDeck;
  user: User;
  search: string;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState(false);
  const [studying, setStudying] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const cards = deck.cards.filter(
    (card) =>
      matchesCard(card, search) ||
      [deck.name, ...deck.tags]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deckRequest(user, { action: "delete", deckId: deck.id });
      refresh();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="gap-0 py-0">
      <details className="group/deck">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-6 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <h2 className="min-w-0 text-lg font-semibold break-words">
            {deck.name}
          </h2>
          <ChevronDown
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground transition-transform group-open/deck:rotate-180"
          />
        </summary>
        <CardContent className="space-y-4 pb-6">
          <p className="text-sm text-muted-foreground">
            {deck.visibility === "team"
              ? `Shared with ${deck.teamName}`
              : "Private · Only you can access this deck"}
            {!deck.canEdit &&
              " · Read-only; you can copy cards to your own decks."}
          </p>
          {deck.description && (
            <p className="break-words">{deck.description}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {deck.cards.length} saved questions
            {search && ` · ${cards.length} matching`}
          </p>
          <div className="flex flex-wrap gap-2">
            {deck.tags.map((tag) => (
              <span className="badge" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {deck.canEdit && (
              <Button variant="outline" onClick={() => setEditing(!editing)}>
                Edit deck
              </Button>
            )}
            {deck.sharedId && (
              <Button variant="outline" asChild disabled={!deck.cards.length}>
                <Link
                  href={`/practice?sharedId=${encodeURIComponent(deck.sharedId)}`}
                >
                  Practice shared deck
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!cards.length}
              onClick={() => setStudying(!studying)}
            >
              {studying ? "Close flashcards" : "Study flashcards"}
            </Button>
            {deck.canEdit && deck.id !== "starred" && (
              <Button variant="ghost" onClick={() => setDeleting(!deleting)}>
                Delete deck
              </Button>
            )}
          </div>
          <DeckExport deck={deck} user={user} />
          {deleting && (
            <div className="space-y-2 rounded-lg border p-3">
              <p>
                Delete “{deck.name}” and all its saved cards? This cannot be
                undone.
              </p>
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => void remove()}>
                  Confirm delete deck
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDeleting(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {error && <Notice error>{error}</Notice>}
          {editing && (
            <DeckEditor
              key={JSON.stringify([
                deck.name,
                deck.description,
                deck.tags,
                deck.visibility,
              ])}
              deck={deck}
              user={user}
              done={() => {
                setEditing(false);
                refresh();
              }}
            />
          )}
          {studying && cards.length > 0 && (
            <Flashcards
              key={`${search}:${cards.map((card) => card.id).join(",")}`}
              cards={cards}
              user={user}
              deck={deck}
            />
          )}
          {!cards.length && (
            <Notice>
              {deck.cards.length
                ? "No cards match your search."
                : "Add questions from practice or history to start studying."}
            </Notice>
          )}
          {cards.map((card) => (
            <SavedCardPanel
              key={card.id}
              card={card}
              deckId={deck.id}
              canEdit={deck.canEdit}
              sharedId={deck.sharedId}
              user={user}
              refresh={refresh}
            />
          ))}
        </CardContent>
      </details>
    </Card>
  );
}
function DeckEditor({
  deck,
  user,
  done,
}: {
  deck: StudyDeck;
  user: User;
  done: () => void;
}) {
  const [name, setName] = useState(deck.name),
    [description, setDescription] = useState(deck.description),
    [tags, setTags] = useState(deck.tags.join(", "));
  const [visibility, setVisibility] = useState(deck.visibility);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await deckRequest(user, {
        action: "update",
        deckId: deck.id,
        name,
        description,
        tags: tagsFrom(tags),
        visibility,
      });
      done();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border p-4">
      <fieldset disabled={busy} className="space-y-3">
        {deck.id !== "starred" && (
          <VisibilityField
            id={`visibility-${deck.id}`}
            value={visibility}
            onChange={setVisibility}
          />
        )}
        <FormField id={`name-${deck.id}`} label="Deck name">
          <Input
            id={`name-${deck.id}`}
            value={name}
            required
            maxLength={80}
            disabled={deck.id === "starred"}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField id={`description-${deck.id}`} label="Deck description">
          <Input
            id={`description-${deck.id}`}
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
        <FormField id={`tags-${deck.id}`} label="Topic tags">
          <Input
            id={`tags-${deck.id}`}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </FormField>
        <Button type="submit" disabled={busy}>
          Save deck changes
        </Button>
      </fieldset>
      {error && <Notice error>{error}</Notice>}
    </form>
  );
}
function VisibilityField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: StudyDeck["visibility"];
  onChange: (value: StudyDeck["visibility"]) => void;
}) {
  return (
    <FormField
      id={id}
      label="Deck visibility"
      hint={
        value === "team"
          ? "School members can view all cards, edits, tags, and notes. Only you can edit. Copies saved by teammates remain theirs after you stop sharing."
          : "Only you can view and edit this deck."
      }
    >
      <select
        id={id}
        className="form-select"
        value={value}
        onChange={(event) =>
          onChange(event.target.value as StudyDeck["visibility"])
        }
      >
        <option value="private">Private</option>
        <option value="team">Team-shared</option>
      </select>
    </FormField>
  );
}
function QuestionFace({
  question,
  answer = false,
}: {
  question: SavedCard["question"];
  answer?: boolean;
}) {
  return (
    <div className="space-y-3 break-words">
      {!answer && question.leadin && <p>{question.leadin}</p>}
      {(answer ? question.answerLines : question.parts).map((text, index) => (
        <div key={index} className="whitespace-pre-wrap leading-7">
          {question.parts.length > 1 && (
            <p className="font-semibold">Part {index + 1}</p>
          )}
          <p>{text}</p>
        </div>
      ))}
    </div>
  );
}
function Flashcards({
  cards,
  user,
  deck,
}: {
  cards: SavedCard[];
  user: User;
  deck: StudyDeck;
}) {
  const [reviewError, setReviewError] = useState("");
  const [saving, setSaving] = useState(false);
  const receipt = useRef<{
    cardId: string;
    requestId: string;
    saved: boolean;
  } | null>(null);
  async function saveReview() {
    if (saving) return;
    if (!receipt.current || receipt.current.cardId !== card.id)
      receipt.current = {
        cardId: card.id,
        requestId: crypto.randomUUID(),
        saved: false,
      };
    const record = receipt.current;
    if (record.saved) return;
    setSaving(true);
    setReviewError("");
    try {
      const response = await fetch("/api/decks/reviews", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: record.requestId,
          cardId: record.cardId,
          deckId: deck.id,
          ...(deck.sharedId ? { sharedId: deck.sharedId } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      record.saved = true;
    } catch (error) {
      setReviewError(message(error));
    } finally {
      setSaving(false);
    }
  }
  const [index, setIndex] = useState(0),
    [flipped, setFlipped] = useState(false);
  const card = cards[Math.min(index, cards.length - 1)];
  return (
    <section
      aria-label="Full-question flashcards"
      className="space-y-4 rounded-lg border bg-accent p-4"
    >
      <p className="text-sm">
        Card {index + 1} of {cards.length} · {flipped ? "Answer" : "Question"}
      </p>
      <QuestionFace question={card.question} answer={flipped} />
      <p className="text-xs text-muted-foreground">
        Revealing an answer records an in-site flashcard review, not a scored
        practice attempt.
      </p>
      {saving && <Notice>Saving review…</Notice>}
      {reviewError && (
        <Notice error>
          {reviewError}{" "}
          <Button
            variant="outline"
            onClick={() => void saveReview()}
            disabled={saving}
          >
            Retry saving review
          </Button>
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={index === 0 || saving}
          onClick={() => {
            receipt.current = null;
            setReviewError("");
            setIndex(index - 1);
            setFlipped(false);
          }}
        >
          Previous card
        </Button>
        <Button
          disabled={saving}
          onClick={() => {
            if (!flipped) void saveReview();
            setFlipped(!flipped);
          }}
        >
          {flipped ? "Show question" : "Flip to answer"}
        </Button>
        <Button
          variant="outline"
          disabled={index + 1 >= cards.length || saving}
          onClick={() => {
            receipt.current = null;
            setReviewError("");
            setIndex(index + 1);
            setFlipped(false);
          }}
        >
          Next card
        </Button>
      </div>
    </section>
  );
}
function SavedCardPanel({
  card,
  deckId,
  user,
  refresh,
  canEdit,
  sharedId,
}: {
  card: SavedCard;
  deckId: string;
  user: User;
  refresh: () => void;
  canEdit: boolean;
  sharedId: string | null;
}) {
  const [editing, setEditing] = useState(false),
    [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deckRequest(user, {
        action: "removeCard",
        deckId,
        cardId: card.id,
      });
      refresh();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-medium break-words">
        {card.question.subcategory || card.question.category || "General"} ·
        Difficulty {card.question.difficulty}
        {card.question.source && ` · ${card.question.source}`}
      </summary>
      <div className="mt-4 space-y-4">
        <QuestionFace question={card.question} />
        <QuestionFace question={card.question} answer />
        <p className="text-xs text-muted-foreground break-words">
          {card.question.source || "QBReader database"}
        </p>
        <div className="flex flex-wrap gap-2">
          {card.tags.map((tag) => (
            <span key={tag} className="badge">
              {tag}
            </span>
          ))}
        </div>
        {card.notes && (
          <p className="whitespace-pre-wrap break-words">{card.notes}</p>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(!editing)}>
              Edit card
            </Button>
            <Button variant="ghost" onClick={() => setRemoving(!removing)}>
              Remove card
            </Button>
          </div>
        )}
        {removing && (
          <div className="space-y-2">
            <p>Remove this card from this deck?</p>
            <Button disabled={busy} onClick={() => void remove()}>
              Confirm remove card
            </Button>
          </div>
        )}
        {editing && (
          <CardEditor
            key={JSON.stringify(card)}
            card={card}
            deckId={deckId}
            user={user}
            done={() => {
              setEditing(false);
              refresh();
            }}
          />
        )}
        <QuestionDeckActions
          user={user}
          source={
            sharedId
              ? { sourceSharedId: sharedId, cardId: card.id }
              : { sourceDeckId: deckId, cardId: card.id }
          }
        />
        <details>
          <summary className="cursor-pointer text-sm">
            Original QBReader question and official answer lines
          </summary>
          <div className="mt-3 space-y-3">
            <QuestionFace question={card.originalQuestion} />
            <QuestionFace question={card.originalQuestion} answer />
          </div>
        </details>
        {error && <Notice error>{error}</Notice>}
      </div>
    </details>
  );
}
function CardEditor({
  card,
  deckId,
  user,
  done,
}: {
  card: SavedCard;
  deckId: string;
  user: User;
  done: () => void;
}) {
  const [parts, setParts] = useState(card.question.parts),
    [lines, setLines] = useState(card.question.answerLines);
  const [leadin, setLeadin] = useState(card.question.leadin),
    [notes, setNotes] = useState(card.notes),
    [tags, setTags] = useState(card.tags.join(", "));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const prefix = `${deckId}-${card.id}`;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await deckRequest(user, {
        action: "editCard",
        deckId,
        cardId: card.id,
        leadin,
        parts,
        answerLines: lines,
        notes,
        tags: tagsFrom(tags),
      });
      done();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border p-4">
      <p className="text-sm">
        Your edits affect this deck’s flashcards. The original question and
        official answers stay saved.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        {card.question.type === "bonus" && (
          <FormField id={`${prefix}-leadin`} label="Bonus lead-in">
            <textarea
              className="form-select"
              id={`${prefix}-leadin`}
              value={leadin}
              maxLength={20000}
              onChange={(e) => setLeadin(e.target.value)}
            />
          </FormField>
        )}
        {parts.map((part, index) => (
          <div key={index} className="space-y-3">
            <FormField
              id={`${prefix}-part-${index}`}
              label={`Question part ${index + 1}`}
            >
              <textarea
                className="form-select min-h-28"
                id={`${prefix}-part-${index}`}
                required
                maxLength={20000}
                value={part}
                onChange={(e) =>
                  setParts(
                    parts.map((text, i) =>
                      i === index ? e.target.value : text,
                    ),
                  )
                }
              />
            </FormField>
            <FormField
              id={`${prefix}-answer-${index}`}
              label={`Answer part ${index + 1}`}
            >
              <textarea
                className="form-select"
                id={`${prefix}-answer-${index}`}
                required
                maxLength={5000}
                value={lines[index]}
                onChange={(e) =>
                  setLines(
                    lines.map((text, i) =>
                      i === index ? e.target.value : text,
                    ),
                  )
                }
              />
            </FormField>
          </div>
        ))}
        <FormField id={`${prefix}-tags`} label="Card topic tags">
          <Input
            id={`${prefix}-tags`}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </FormField>
        <FormField id={`${prefix}-notes`} label="Study notes">
          <textarea
            className="form-select"
            id={`${prefix}-notes`}
            maxLength={5000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>
        <Button type="submit" disabled={busy}>
          Save card changes
        </Button>
      </fieldset>
      {error && <Notice error>{error}</Notice>}
    </form>
  );
}
