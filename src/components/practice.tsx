"use client";

import { QuestionDeckActions } from "./study-decks";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { FormField, Notice } from "@/components/form-field";
import {
  subjects,
  type Question,
  type Attempt,
  type Outcome,
} from "@/lib/practice";

export function Practice() {
  const { user, loading } = useAuth();
  return (
    <PracticeWorkspace
      key={user?.uid || "guest"}
      historyKey={`quizbowl:answered:v1:${user?.uid || "guest"}`}
      accountLoading={loading}
      user={user}
    />
  );
}

function PracticeWorkspace({
  historyKey,
  accountLoading,
  user,
}: {
  historyKey: string;
  accountLoading: boolean;
  user: User | null;
}) {
  const [type, setType] = useState<Question["type"]>("tossup");
  const [difficulty, setDifficulty] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(10);
  const [avoid, setAvoid] = useState(false);
  const [retryAttemptId, setRetryAttemptId] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [index, setIndex] = useState(0);
  const [part, setPart] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buzzed, setBuzzed] = useState(false);
  const [answer, setAnswer] = useState("");
  const [prompt, setPrompt] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingKind, setPendingKind] = useState<"answer" | "skip" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storageNotice, setStorageNotice] = useState("");
  const [stage, setStage] = useState<"setup" | "reading" | "summary">("setup");
  const [speed, setSpeed] = useState(250);
  const lock = useRef(false);
  const pending = useRef<{
    fingerprint: string;
    requestId: string;
    skipped: boolean;
  } | null>(null);
  const answered = useRef<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const question = questions[index];
  const words = question?.parts[part]?.split(/\s+/) || [];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    queueMicrotask(() => setRetryAttemptId(params.get("retryAttemptId") || ""));
    const recommendedCategory = params.get("category") || "";
    const recommendedSubcategory = params.get("subcategory") || "";
    if (Object.hasOwn(subjects, recommendedCategory)) {
      queueMicrotask(() => {
        setCategory(recommendedCategory);
        if (subjects[recommendedCategory].includes(recommendedSubcategory))
          setSubcategory(recommendedSubcategory);
      });
    }
  }, []);

  useEffect(() => {
    if (
      !playing ||
      buzzed ||
      outcome ||
      stage !== "reading" ||
      revealed >= words.length
    )
      return;
    const timer = setInterval(
      () => setRevealed((n) => Math.min(n + 1, words.length)),
      speed,
    );
    return () => clearInterval(timer);
  }, [playing, buzzed, outcome, stage, revealed, words.length, speed]);

  useEffect(() => {
    if (buzzed && !outcome) input.current?.focus();
  }, [buzzed, outcome]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setStorageNotice("");
    try {
      const saved = JSON.parse(localStorage.getItem(historyKey) || "[]");
      if (!Array.isArray(saved)) throw new Error("Invalid local history");
      answered.current = [
        ...new Set([
          ...answered.current,
          ...saved.filter(
            (id): id is string => typeof id === "string" && id.length <= 100,
          ),
        ]),
      ].slice(-10000);
    } catch {
      setStorageNotice(
        "Local history is unavailable. Session results will still be counted.",
      );
      if (avoid && !retryAttemptId) {
        setError(
          "Cannot read local history. Turn off ‘Avoid previously answered questions’ to continue.",
        );
        setBusy(false);
        lock.current = false;
        return;
      }
    }
    try {
      const response = await fetch("/api/practice/questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(user
            ? { Authorization: `Bearer ${await user.getIdToken()}` }
            : {}),
        },
        body: JSON.stringify({
          ...(retryAttemptId ? { retryAttemptId } : {}),
          type,
          count,
          difficulty: difficulty === "" ? "" : Number(difficulty),
          category,
          subcategory,
          topic,
          excluded: avoid ? answered.current : [],
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Unable to load questions.");
      if (!data.questions.length)
        throw new Error(
          "No new questions match these filters. Try a broader topic or change the filters.",
        );
      setQuestions(data.questions);
      if (user && !data.sessionId)
        throw new Error("Practice saving is unavailable. Please retry.");
      setSessionId(data.sessionId || null);
      setAttempts([]);
      setIndex(0);
      setPart(0);
      resetPart();
      setStage("reading");
      if (!retryAttemptId && data.questions.length < count)
        setNotice(
          `Found ${data.questions.length} of ${count} requested questions. Your session uses the available matches.`,
        );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to load questions. Please retry.",
      );
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  function resetPart() {
    pending.current = null;
    setPendingKind(null);
    setRevealed(0);
    setPlaying(false);
    setBuzzed(false);
    setAnswer("");
    setPrompt("");
    setOutcome(null);
    setError("");
  }

  async function saveResponse(skipped: boolean) {
    if (!user || !sessionId)
      throw new Error("Sign in and start a new session to save responses.");
    const payload = {
      sessionId,
      questionIndex: index,
      part,
      givenAnswer: skipped ? "" : answer.trim(),
      skipped,
      revealedWords: question.type === "bonus" ? words.length : revealed,
    };
    const fingerprint = JSON.stringify(payload);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = {
        fingerprint,
        requestId: crypto.randomUUID(),
        skipped,
      };
    setPendingKind(skipped ? "skip" : "answer");
    const response = await fetch("/api/practice/attempts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({
        ...payload,
        requestId: pending.current.requestId,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status < 500) {
        pending.current = null;
        setPendingKind(null);
      }
      throw new Error(
        result.error || "Your response could not be saved. Please retry.",
      );
    }
    pending.current = null;
    setPendingKind(null);
    return result;
  }

  async function skip() {
    if (lock.current || outcome) return;
    lock.current = true;
    setBusy(true);
    setPlaying(false);
    setError("");
    try {
      if (user) await saveResponse(true);
      record("skipped");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Your skip could not be saved. Please retry.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function record(result: Outcome) {
    setOutcome(result);
    setPlaying(false);
    setPrompt("");
    setAttempts((previous) => [
      ...previous,
      {
        questionId: question.id,
        part,
        answer: result === "skipped" ? "" : answer.trim(),
        outcome: result,
      },
    ]);
    if (result !== "skipped" && !answered.current.includes(question.id)) {
      answered.current = [...answered.current, question.id].slice(-10000);
      try {
        localStorage.setItem(historyKey, JSON.stringify(answered.current));
      } catch {
        setStorageNotice(
          "Your result is counted in this session, but local history could not be saved.",
        );
      }
    }
  }

  async function check(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || outcome || !answer.trim()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let result;
      if (user) result = await saveResponse(false);
      else {
        const response = await fetch("/api/practice/check-answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answerline: question.answers[part],
            givenAnswer: answer,
          }),
        });
        result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Unable to check your answer.");
      }
      if (result.directive === "prompt") {
        setPrompt(result.directedPrompt || "Please be more specific.");
        setAnswer("");
        input.current?.focus();
      } else record(result.directive === "accept" ? "correct" : "incorrect");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to check your answer. Retry without losing your response.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function next() {
    if (part + 1 < question.parts.length) setPart(part + 1);
    else if (index + 1 < questions.length) {
      setIndex(index + 1);
      setPart(0);
    } else setStage("summary");
    resetPart();
  }

  const correct = attempts.filter((a) => a.outcome === "correct").length;
  const incorrect = attempts.filter((a) => a.outcome === "incorrect").length;
  const skipped = attempts.filter((a) => a.outcome === "skipped").length;
  const lastPart = question && part === question.parts.length - 1;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Questions from{" "}
        <a
          className="underline"
          href="https://www.qbreader.org"
          target="_blank"
          rel="noreferrer"
        >
          QBReader
        </a>
        .{" "}
        {user
          ? "Your practice responses are saved automatically to your account."
          : "Sign in to save your practice responses. Guest session results are temporary."}{" "}
        Previously answered question filtering uses this browser’s history.
      </p>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {storageNotice && <Notice>{storageNotice}</Notice>}
      {stage === "setup" && (
        <Card>
          <CardContent>
            <form onSubmit={start} className="space-y-6">
              {retryAttemptId && (
                <Notice>
                  Retry the original missed question in a new saved session. For
                  bonuses, all parts are included. Session filters below apply
                  only to new random practice.
                </Notice>
              )}
              {retryAttemptId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setRetryAttemptId("");
                    window.history.replaceState(null, "", "/practice");
                  }}
                >
                  Practice new questions instead
                </Button>
              )}
              <fieldset disabled={busy || accountLoading} className="space-y-6">
                <h2 className="text-xl font-semibold">Set up your session</h2>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <FormField id="question-type" label="Question type">
                    <select
                      id="question-type"
                      className="form-select"
                      value={type}
                      onChange={(e) =>
                        setType(e.target.value as Question["type"])
                      }
                    >
                      <option value="tossup">Tossups</option>
                      <option value="bonus">Bonuses</option>
                    </select>
                  </FormField>
                  <FormField id="difficulty" label="Difficulty">
                    <select
                      id="difficulty"
                      className="form-select"
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value)}
                    >
                      <option value="">All difficulties</option>
                      {Array.from({ length: 11 }, (_, n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField
                    id="question-count"
                    label="Number of questions"
                    hint="1–50 questions; bonuses include every part."
                  >
                    <Input
                      id="question-count"
                      type="number"
                      min={1}
                      max={50}
                      required
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                    />
                  </FormField>
                  <FormField id="category" label="Category">
                    <select
                      id="category"
                      className="form-select"
                      value={category}
                      onChange={(e) => {
                        setCategory(e.target.value);
                        setSubcategory("");
                      }}
                    >
                      <option value="">All categories</option>
                      {Object.keys(subjects).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField id="subcategory" label="Subcategory">
                    <select
                      id="subcategory"
                      className="form-select"
                      value={subcategory}
                      onChange={(e) => setSubcategory(e.target.value)}
                    >
                      <option value="">All subcategories</option>
                      {(category
                        ? subjects[category]
                        : Object.values(subjects).flat()
                      ).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField
                    id="topic"
                    label="Specific topic"
                    hint="Search question text and answer lines."
                  >
                    <Input
                      id="topic"
                      maxLength={200}
                      placeholder="e.g. photosynthesis"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                    />
                  </FormField>
                </div>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={avoid}
                    onChange={(e) => setAvoid(e.target.checked)}
                  />
                  Avoid previously answered questions
                </label>
                <Button disabled={busy || accountLoading} type="submit">
                  {busy
                    ? "Loading questions…"
                    : retryAttemptId
                      ? "Retry missed question"
                      : "Start session"}
                </Button>
              </fieldset>
            </form>
          </CardContent>
        </Card>
      )}
      {stage === "reading" && question && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>
              Question {index + 1} of {questions.length}
              {question.type === "bonus" &&
                ` · Part ${part + 1} of ${question.parts.length}`}
            </p>
            <p aria-live="polite">
              Correct: {correct} · Incorrect: {incorrect} · Skipped: {skipped}
            </p>
          </div>
          <Card>
            <CardContent className="space-y-6">
              {user && sessionId && (
                <QuestionDeckActions
                  key={`${sessionId}-${index}`}
                  user={user}
                  source={{ sessionId, questionIndexes: [index] }}
                  star
                />
              )}
              <div className="flex flex-wrap gap-2">
                <span className="badge">{question.category}</span>
                <span className="badge">{question.subcategory}</span>
                <span className="badge">Difficulty {question.difficulty}</span>
              </div>
              {question.type === "bonus" && (
                <p className="leading-8">{question.leadin}</p>
              )}
              <h2 className="text-lg font-semibold">
                {question.type === "tossup"
                  ? "Tossup"
                  : `Bonus part ${part + 1}`}
              </h2>
              <p
                data-testid="question-text"
                className="min-h-24 whitespace-pre-wrap text-lg leading-9 break-words"
              >
                {question.type === "bonus" || outcome
                  ? question.parts[part]
                  : words.slice(0, revealed).join(" ") ||
                    "Press Read to begin revealing the question."}
              </p>
              {question.type === "tossup" && !outcome && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      pendingKind !== null ||
                      buzzed ||
                      revealed >= words.length
                    }
                    onClick={() => setPlaying(!playing)}
                  >
                    {playing ? "Pause" : "Read"}
                  </Button>
                  <Button
                    disabled={
                      busy || pendingKind !== null || buzzed || revealed === 0
                    }
                    onClick={() => {
                      setBuzzed(true);
                      setPlaying(false);
                    }}
                  >
                    Buzz
                  </Button>
                  <label className="flex items-center gap-2 text-sm">
                    Reading speed
                    <select
                      aria-label="Reading speed"
                      className="form-select w-auto"
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    >
                      <option value={400}>Slow</option>
                      <option value={250}>Normal</option>
                      <option value={120}>Fast</option>
                    </select>
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {revealed} / {words.length} words
                  </span>
                </div>
              )}
              {!outcome && (buzzed || question.type === "bonus") && (
                <form onSubmit={check} className="space-y-3">
                  {prompt && <Notice>{prompt}</Notice>}
                  <FormField
                    id="given-answer"
                    label={prompt ? "Clarify your answer" : "Your answer"}
                  >
                    <Input
                      ref={input}
                      id="given-answer"
                      autoComplete="off"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      maxLength={500}
                      disabled={busy || pendingKind !== null}
                      required
                    />
                  </FormField>
                  <Button type="submit" disabled={busy || !answer.trim()}>
                    {busy ? "Checking…" : "Check answer"}
                  </Button>
                </form>
              )}
              {!outcome && (
                <Button
                  variant="ghost"
                  disabled={busy || pendingKind === "answer"}
                  onClick={skip}
                >
                  Skip and reveal answer
                </Button>
              )}
              {outcome && (
                <div className="space-y-4 rounded-lg border bg-accent p-4">
                  <p role="status" className="font-semibold">
                    {outcome === "correct"
                      ? "Correct"
                      : outcome === "incorrect"
                        ? "Incorrect"
                        : "Skipped"}
                  </p>
                  {outcome !== "skipped" && (
                    <p className="text-sm">Your response: {answer}</p>
                  )}
                  <div>
                    <h3 className="text-sm font-semibold">
                      Official answer line and accepted alternatives
                    </h3>
                    <p className="mt-2 leading-7 break-words">
                      {question.answerLines[part]}
                    </p>
                  </div>
                  <Button onClick={next}>
                    {!lastPart
                      ? "Next part"
                      : index + 1 < questions.length
                        ? "Next question"
                        : "View summary"}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground break-words">
                {question.source || "QBReader database"}
              </p>
            </CardContent>
          </Card>
        </>
      )}
      {stage === "summary" && (
        <Card>
          <CardContent className="space-y-6">
            <h2 className="text-xl font-semibold">Session summary</h2>
            <p>
              {questions.length} {type === "bonus" ? "bonuses" : "tossups"}{" "}
              completed · {attempts.length}{" "}
              {type === "bonus" ? "bonus parts" : "responses"}
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Correct", correct],
                ["Incorrect", incorrect],
                ["Skipped", skipped],
                [
                  "Accuracy",
                  `${correct + incorrect ? Math.round((correct / (correct + incorrect)) * 100) : 0}%`,
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-muted p-4">
                  <p className="text-2xl font-semibold">{value}</p>
                  <p className="text-sm text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Accuracy excludes skipped responses. Each bonus part counts
              separately.
            </p>
            <div className="space-y-3">
              {questions.map((q, i) => (
                <details key={q.id} className="rounded-lg border p-4">
                  <summary className="cursor-pointer">
                    Question {i + 1} · {q.category} ·{" "}
                    {
                      attempts.filter(
                        (a) => a.questionId === q.id && a.outcome === "correct",
                      ).length
                    }
                    /{q.parts.length} correct
                  </summary>
                  <div className="mt-4 space-y-4">
                    {q.parts.map((text, p) => {
                      const attempt = attempts.find(
                        (a) => a.questionId === q.id && a.part === p,
                      );
                      return (
                        <div key={p} className="space-y-2 text-sm leading-7">
                          <p>{text}</p>
                          <p className="font-medium">
                            {attempt?.outcome}{" "}
                            {attempt?.answer &&
                              `· Your response: ${attempt.answer}`}
                          </p>
                          <p>Answer: {q.answerLines[p]}</p>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
            <Button
              onClick={() => {
                setStage("setup");
                setNotice("");
                setError("");
              }}
            >
              New session
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
