import "server-only";
import { randomUUID } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import type { Question, Outcome } from "@/lib/practice";
import { qbreader } from "@/lib/server/qbreader";
import { prepareDailyStatistics } from "./daily-statistics";
import {
  prepareAssignmentCredit,
  type AssignmentBinding,
} from "./assignment-progress";

export class PracticeError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function authenticatePractice(request: Request, required = true) {
  const header = request.headers.get("authorization");
  if (!header && !required) return null;
  const token = header?.match(/^Bearer (\S+)$/)?.[1];
  if (!token)
    throw new PracticeError("Sign in to save practice attempts.", 401);
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.host !== request.headers.get("host")
      )
        throw new Error("Invalid origin");
    } catch {
      throw new PracticeError("This request is not allowed.", 403);
    }
  }
  let services;
  try {
    services = getFirebaseAdmin();
  } catch {
    throw new PracticeError(
      "Practice saving is unavailable. Please retry.",
      503,
    );
  }
  const { auth, db } = services;
  try {
    const account = await auth.verifyIdToken(token, true);
    return { uid: account.uid, db, authTime: account.auth_time || 0 };
  } catch {
    throw new PracticeError("Your session expired. Sign in again.", 401);
  }
}

export async function createPracticeSession(
  db: Firestore,
  uid: string,
  questions: Question[],
) {
  const id = randomUUID();
  const ref = db.doc(`users/${uid}/practiceSessions/${id}`);
  const batch = db.batch();
  batch.create(ref, {
    createdAt: FieldValue.serverTimestamp(),
    questionCount: questions.length,
    totalParts: questions.reduce((n, q) => n + q.parts.length, 0),
    attemptedParts: 0,
    correct: 0,
    incorrect: 0,
    skipped: 0,
  });
  questions.forEach((q, index) =>
    batch.create(ref.collection("questions").doc(String(index)), q),
  );
  try {
    await batch.commit();
  } catch {
    throw new PracticeError(
      "Your practice session could not be saved. Please retry.",
      503,
    );
  }
  return id;
}

type Submission = {
  requestId: string;
  answer: string;
  directive: "accept" | "reject" | "prompt" | "skip";
  directedPrompt: string | null;
  submittedAt: string;
  revealedWords: number;
};
type SavedAttempt = {
  submissions: Submission[];
  outcome: Outcome | "prompt";
  createdAt: unknown;
};
type SubmissionReceipt = {
  input: Omit<AttemptInput, "requestId">;
  submission: Submission;
  attemptId: string;
};
export type AttemptInput = {
  sessionId: string;
  questionIndex: number;
  part: number;
  requestId: string;
  givenAnswer: string;
  skipped: boolean;
  revealedWords: number;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseAttempt(value: unknown): AttemptInput {
  const body = value as AttemptInput;
  if (
    !body ||
    typeof body !== "object" ||
    typeof body.sessionId !== "string" ||
    !uuid.test(body.sessionId) ||
    typeof body.requestId !== "string" ||
    !uuid.test(body.requestId) ||
    !Number.isInteger(body.questionIndex) ||
    body.questionIndex < 0 ||
    body.questionIndex >= 50 ||
    !Number.isInteger(body.part) ||
    body.part < 0 ||
    body.part > 20 ||
    typeof body.givenAnswer !== "string" ||
    body.givenAnswer.length > 500 ||
    typeof body.skipped !== "boolean" ||
    (!body.skipped && !body.givenAnswer.trim()) ||
    (body.skipped && body.givenAnswer !== "") ||
    !Number.isInteger(body.revealedWords) ||
    body.revealedWords < 0
  )
    throw new PracticeError("Invalid practice attempt.", 400);
  return {
    sessionId: body.sessionId.toLowerCase(),
    requestId: body.requestId.toLowerCase(),
    questionIndex: body.questionIndex,
    part: body.part,
    givenAnswer: body.givenAnswer.trim(),
    skipped: body.skipped,
    revealedWords: body.revealedWords,
  };
}
function replay(previous: SavedAttempt | undefined, input: AttemptInput) {
  const submission = previous?.submissions.find(
    (s) => s.requestId.toLowerCase() === input.requestId,
  );
  if (
    submission &&
    (submission.answer !== input.givenAnswer.trim() ||
      (submission.directive === "skip") !== input.skipped ||
      submission.revealedWords !== input.revealedWords)
  )
    throw new PracticeError(
      "This submission ID was already used for another response.",
      409,
    );
  return submission;
}
function submissionBinding(input: AttemptInput): SubmissionReceipt["input"] {
  return {
    sessionId: input.sessionId,
    questionIndex: input.questionIndex,
    part: input.part,
    givenAnswer: input.givenAnswer,
    skipped: input.skipped,
    revealedWords: input.revealedWords,
  };
}
function replayReceipt(
  receipt: SubmissionReceipt | undefined,
  input: AttemptInput,
) {
  if (!receipt) return null;
  const binding = submissionBinding(input);
  if (
    Object.keys(binding).some((key) => {
      const field = key as keyof typeof binding;
      return receipt.input[field] !== binding[field];
    })
  )
    throw new PracticeError(
      "This submission ID was already used for another response.",
      409,
    );
  return result(receipt.submission, receipt.attemptId);
}
function result(submission: Submission, attemptId: string) {
  return {
    directive: submission.directive,
    directedPrompt: submission.directedPrompt,
    attemptId,
    saved: true,
  };
}
export async function savePracticeAttempt(
  db: Firestore,
  uid: string,
  input: AttemptInput,
) {
  const sessionRef = db.doc(`users/${uid}/practiceSessions/${input.sessionId}`);
  const questionRef = sessionRef
    .collection("questions")
    .doc(String(input.questionIndex));
  const attemptId = `${input.sessionId}_${input.questionIndex}_${input.part}`;
  const attemptRef = db.doc(`users/${uid}/attempts/${attemptId}`);
  // An ID belongs to one response across this account, not just within one part.
  // Commit its receipt atomically with history and session totals.
  const receiptRef = db.doc(
    `users/${uid}/attemptSubmissions/${input.requestId}`,
  );
  const [questionSnapshot, previousSnapshot, receiptSnapshot] = await db.getAll(
    questionRef,
    attemptRef,
    receiptRef,
  );
  const receiptReplay = replayReceipt(
    receiptSnapshot.data() as SubmissionReceipt | undefined,
    input,
  );
  if (receiptReplay) return receiptReplay;
  if (!questionSnapshot.exists)
    throw new PracticeError(
      "This practice session could not be found. Start a new session.",
      404,
    );
  const question = questionSnapshot.data() as Question;
  if (
    input.part >= question.parts.length ||
    input.revealedWords > question.parts[input.part].split(/\s+/).length
  )
    throw new PracticeError("Invalid question part or reading position.", 400);
  const previous = previousSnapshot.data() as SavedAttempt | undefined;
  const cached = replay(previous, input);
  if (!cached && previous && previous.outcome !== "prompt")
    throw new PracticeError(
      "This question part has already been completed.",
      409,
    );
  if (!cached && (previous?.submissions.length || 0) >= 20 && !input.skipped)
    throw new PracticeError(
      "Too many clarifications. Skip this part to continue.",
      400,
    );
  const judgement =
    cached ||
    (input.skipped
      ? { directive: "skip", directedPrompt: null }
      : await qbreader(
          "check-answer",
          new URLSearchParams({
            answerline: question.answers[input.part],
            givenAnswer: input.givenAnswer.trim(),
          }),
        ));
  if (
    !(input.skipped ? ["skip"] : ["accept", "reject", "prompt"]).includes(
      String(judgement.directive),
    )
  )
    throw new PracticeError(
      "Answer checking is unavailable. Please retry.",
      502,
    );
  const submission: Submission = cached || {
    requestId: input.requestId,
    answer: input.givenAnswer.trim(),
    directive: judgement.directive as Submission["directive"],
    directedPrompt:
      typeof judgement.directedPrompt === "string"
        ? judgement.directedPrompt
        : null,
    submittedAt: new Date().toISOString(),
    revealedWords: input.revealedWords,
  };
  const outcome =
    submission.directive === "accept"
      ? "correct"
      : submission.directive === "reject"
        ? "incorrect"
        : submission.directive === "skip"
          ? "skipped"
          : "prompt";
  return db.runTransaction(async (transaction) => {
    const [snapshot, session, receipt] = await transaction.getAll(
      attemptRef,
      sessionRef,
      receiptRef,
    );
    const repeated = replayReceipt(
      receipt.data() as SubmissionReceipt | undefined,
      input,
    );
    if (repeated) return repeated;
    if (!session.exists)
      throw new PracticeError("This practice session could not be found.", 404);
    const current = snapshot.data() as SavedAttempt | undefined;
    const duplicate = replay(current, input);
    if (duplicate) {
      // Upgrade old attempts on replay without adding history or changing totals.
      transaction.create(receiptRef, {
        input: submissionBinding(input),
        submission: duplicate,
        attemptId,
        createdAt: FieldValue.serverTimestamp(),
      });
      return result(duplicate, attemptId);
    }
    if (
      (current?.submissions.length || 0) !==
        (previous?.submissions.length || 0) ||
      (current && current.outcome !== "prompt")
    )
      throw new PracticeError(
        "Another response was already recorded for this part.",
        409,
      );
    const writeAssignmentCredit = await prepareAssignmentCredit(
      db,
      transaction,
      uid,
      session.data()!.assignment as AssignmentBinding | undefined,
      question,
      input.part,
      outcome,
    );
    const writeDailyStatistics = await prepareDailyStatistics(
      db,
      transaction,
      uid,
      input.sessionId,
      input.questionIndex,
      outcome,
    );
    const timestamp = FieldValue.serverTimestamp();
    writeDailyStatistics();
    writeAssignmentCredit();
    transaction.create(receiptRef, {
      input: submissionBinding(input),
      submission,
      attemptId,
      createdAt: timestamp,
    });
    transaction.set(attemptRef, {
      sessionId: input.sessionId,
      questionIndex: input.questionIndex,
      questionId: question.id,
      part: input.part,
      question,
      submittedAnswer: submission.answer,
      outcome,
      submissions: [...(current?.submissions || []), submission],
      createdAt: current?.createdAt || timestamp,
      updatedAt: timestamp,
      ...(outcome !== "prompt" ? { completedAt: timestamp } : {}),
    });
    if (outcome !== "prompt") {
      const attemptedParts = session.data()!.attemptedParts + 1;
      transaction.update(sessionRef, {
        attemptedParts,
        [outcome]: FieldValue.increment(1),
        updatedAt: timestamp,
        ...(attemptedParts === session.data()!.totalParts
          ? { completedAt: timestamp }
          : {}),
      });
    } else transaction.update(sessionRef, { updatedAt: timestamp });
    return result(submission, attemptId);
  });
}
