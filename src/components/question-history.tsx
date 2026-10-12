"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { AccountGuard } from "./account-guard";
import { PageHeading } from "./page-heading";
import { FormField, Notice } from "./form-field";
import { Button } from "./ui/button";
import { QuestionDeckActions } from "./study-decks";
import { Card, CardContent } from "./ui/card";
import { subjects, type Question } from "@/lib/practice";
import type {
  HistoryAttempt,
  HistoryFilters,
  HistoryPage,
} from "@/lib/history";

const selectClass = "h-10 w-full rounded-lg border bg-background px-3 text-sm";
async function accountRequest(
  user: User,
  url: string,
  signal?: AbortSignal,
  body?: unknown,
) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
    signal,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Please retry.");
  return data;
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unable to load your workspace. Please retry.";
export function QuestionHistory() {
  const { user } = useAuth();
  return (
    <AccountGuard>
      {user && <HistoryWorkspace key={user.uid} user={user} />}
    </AccountGuard>
  );
}
function HistoryWorkspace({ user }: { user: User }) {
  const [filters, setFilters] = useState<HistoryFilters>({
    category: "",
    subcategory: "",
    difficulty: "",
    outcome: "",
  });
  const [cursor, setCursor] = useState("");
  const [data, setData] = useState<HistoryPage | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ ...filters, cursor });
    void accountRequest(user, `/api/history?${params}`, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(message(failure));
      });
    return () => controller.abort();
  }, [user, filters, cursor, reload]);
  function change(key: keyof HistoryFilters, value: string) {
    setData(null);
    setError("");
    setCursor("");
    setFilters((previous) => ({
      ...previous,
      [key]: value,
      ...(key === "category" ? { subcategory: "" } : {}),
    }));
  }
  return (
    <div className="space-y-6">
      <PageHeading
        title="Question history"
        description="Your 30 most recent saved attempts. Filter your history, revisit answers, or open older attempts."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id="history-subject" label="Subject">
          <select
            id="history-subject"
            className={selectClass}
            value={filters.category}
            onChange={(e) => change("category", e.target.value)}
          >
            <option value="">All subjects</option>
            {Object.keys(subjects).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <FormField id="history-subcategory" label="Subcategory">
          <select
            id="history-subcategory"
            className={selectClass}
            value={filters.subcategory}
            onChange={(e) => change("subcategory", e.target.value)}
          >
            <option value="">All subcategories</option>
            {(filters.category
              ? subjects[filters.category]
              : Object.values(subjects).flat()
            ).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <FormField id="history-difficulty" label="Difficulty">
          <select
            id="history-difficulty"
            className={selectClass}
            value={filters.difficulty}
            onChange={(e) => change("difficulty", e.target.value)}
          >
            <option value="">All difficulties</option>
            {Array.from({ length: 11 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="history-result" label="Result">
          <select
            id="history-result"
            className={selectClass}
            value={filters.outcome}
            onChange={(e) => change("outcome", e.target.value)}
          >
            <option value="">All results</option>
            <option value="correct">Correct</option>
            <option value="incorrect">Incorrect</option>
            <option value="skipped">Skipped</option>
            <option value="prompt">Awaiting clarification</option>
          </select>
        </FormField>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => {
            setData(null);
            setError("");
            setCursor("");
            setReload((n) => n + 1);
          }}
        >
          Refresh latest attempts
        </Button>
        <Button asChild variant="outline">
          <Link href="/decks">View study decks</Link>
        </Button>
      </div>
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <Notice>Loading your history…</Notice>}
      {data && (
        <>
          {!data.attempts.length && (
            <Notice>
              No saved attempts match these filters. Signed-in practice is saved
              across devices.
            </Notice>
          )}
          <div className="space-y-4">
            {data.attempts.map((attempt) => (
              <AttemptCard key={attempt.id} attempt={attempt} user={user} />
            ))}
          </div>
          {data.nextCursor && (
            <Button
              variant="outline"
              onClick={() => {
                setData(null);
                setError("");
                setCursor(data.nextCursor!);
                window.scrollTo({ top: 0 });
              }}
            >
              Older attempts
            </Button>
          )}
        </>
      )}
    </div>
  );
}
function QuestionText({ question }: { question: Question }) {
  return (
    <div className="space-y-3 text-sm leading-7 break-words">
      {question.leadin && <p>{question.leadin}</p>}
      {question.parts.map((part, index) => (
        <div key={index}>
          <p>
            {question.type === "bonus" && <strong>Part {index + 1}: </strong>}
            {part}
          </p>
          <p className="mt-1 text-muted-foreground">
            <strong>Official answer: </strong>
            {question.answerLines[index]}
          </p>
        </div>
      ))}
      {question.source && (
        <p className="text-xs text-muted-foreground">
          Source: {question.source} · QBReader
        </p>
      )}
    </div>
  );
}
function AttemptCard({
  attempt,
  user,
}: {
  attempt: HistoryAttempt;
  user: User;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <strong>
            {attempt.outcome === "prompt"
              ? "Awaiting clarification"
              : attempt.outcome[0].toUpperCase() + attempt.outcome.slice(1)}
          </strong>
          <span>
            {attempt.question.category} · {attempt.question.subcategory} ·
            Difficulty {attempt.question.difficulty}
          </span>
          {attempt.createdAt && (
            <time dateTime={attempt.createdAt}>
              {new Date(attempt.createdAt).toLocaleString()}
            </time>
          )}
        </div>
        <p className="text-sm break-words">
          <strong>
            Submitted answer
            {attempt.question.type === "bonus"
              ? ` (part ${attempt.part + 1})`
              : ""}
            :{" "}
          </strong>
          {attempt.submittedAnswer || "No answer submitted"}
        </p>
        <p className="text-sm break-words">
          <strong>Official answer: </strong>
          {attempt.question.answerLines[attempt.part]}
        </p>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-primary">
            View full question and response history
          </summary>
          <div className="mt-4 space-y-4">
            <QuestionText question={attempt.question} />
            {attempt.submissions.length > 0 && (
              <ol className="space-y-2 text-sm">
                {attempt.submissions.map((s, i) => (
                  <li key={i} className="break-words">
                    {i + 1}. {s.answer || "Skipped"} — {s.directive}
                    {s.directedPrompt && `: ${s.directedPrompt}`}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </details>
        <div className="flex flex-wrap gap-3">
          {attempt.outcome === "incorrect" && (
            <Button asChild variant="outline">
              <Link
                href={`/practice?retryAttemptId=${encodeURIComponent(attempt.id)}`}
              >
                Retry missed question
              </Link>
            </Button>
          )}
        </div>
        <QuestionDeckActions source={{ attemptId: attempt.id }} user={user} />
      </CardContent>
    </Card>
  );
}
