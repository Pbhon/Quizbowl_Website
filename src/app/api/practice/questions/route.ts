import { normalizeQuestion, subjects, type Question } from "@/lib/practice";
import { qbreader } from "@/lib/server/qbreader";
import { historyQuestion } from "@/lib/server/history";
import { exportDeck } from "@/lib/server/decks";
import {
  assignmentPracticeSource,
  createAssignmentSession,
} from "@/lib/server/assignment-progress";
import { matchesAssignment } from "@/lib/assignment-requirements";
import {
  authenticatePractice,
  createPracticeSession,
  PracticeError,
} from "@/lib/server/practice-persistence";

export async function POST(request: Request) {
  try {
    const account = await authenticatePractice(request, false);
    let body = await request.json();
    if (!body || typeof body !== "object")
      return Response.json(
        { error: "Invalid practice filters." },
        { status: 400 },
      );
    let assignment:
      Awaited<ReturnType<typeof assignmentPracticeSource>> | undefined;
    if (body.assignmentId !== undefined) {
      if (!account)
        throw new PracticeError("Sign in to practice an assignment.", 401);
      if (body.sharedId !== undefined || body.retryAttemptId !== undefined)
        throw new PracticeError("Choose one practice source.", 400);
      assignment = await assignmentPracticeSource(
        account.db,
        account.uid,
        body.assignmentId,
      );
      body = {
        type: assignment.data.type ?? "tossup",
        count: assignment.count,
        difficulty: "",
        category: assignment.data.category ?? "",
        subcategory: assignment.data.subcategory ?? "",
        topic: assignment.data.topic ?? "",
        excluded: assignment.excluded,
      };
    }
    if (body.sharedId !== undefined) {
      if (!account)
        throw new PracticeError("Sign in to practice a shared deck.", 401);
      if (!Number.isInteger(body.count) || body.count < 1 || body.count > 50)
        throw new PracticeError("Choose 1–50 deck questions per session.", 400);
      const { deck } = await exportDeck(
        account.db,
        account.uid,
        undefined,
        body.sharedId,
      );
      const questions = deck.cards
        .slice(0, body.count)
        .map((card) => card.originalQuestion);
      if (!questions.length)
        throw new PracticeError(
          "This shared deck has no questions to practice.",
          400,
        );
      const sessionId = await createPracticeSession(
        account.db,
        account.uid,
        questions,
      );
      return Response.json(
        { questions, sessionId, deckName: deck.name },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (body.retryAttemptId !== undefined) {
      if (!account)
        throw new PracticeError("Sign in to retry a saved question.", 401);
      const question = await historyQuestion(
        account.db,
        account.uid,
        body.retryAttemptId,
        true,
      );
      const sessionId = await createPracticeSession(account.db, account.uid, [
        question,
      ]);
      return Response.json(
        { questions: [question], sessionId },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { type, count, difficulty, category, subcategory, topic, excluded } =
      body;
    if (
      !["tossup", "bonus"].includes(type) ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 50 ||
      (difficulty !== "" &&
        (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 10)) ||
      typeof topic !== "string" ||
      topic.length > 200 ||
      typeof category !== "string" ||
      typeof subcategory !== "string" ||
      (category && !Object.hasOwn(subjects, category)) ||
      (subcategory &&
        !(
          category ? subjects[category] : Object.values(subjects).flat()
        ).includes(subcategory)) ||
      !Array.isArray(excluded) ||
      excluded.length > 10000 ||
      excluded.some((id: unknown) => typeof id !== "string" || id.length > 100)
    ) {
      return Response.json(
        { error: "Invalid practice filters." },
        { status: 400 },
      );
    }
    const params = new URLSearchParams();
    if (difficulty !== "") params.set("difficulties", String(difficulty));
    if (category) params.set("categories", category);
    if (subcategory) params.set("subcategories", subcategory);
    const searching = !!topic.trim();
    if (searching) {
      params.set("q", topic.trim());
      params.set("questionType", type);
      params.set("searchType", "all");
      params.set("randomize", "true");
      params.set("maxReturnLength", "100");
    } else params.set("number", "100");
    const questions: Question[] = [];
    const seen = new Set<string>(excluded);
    // Bound upstream calls even if a narrow pool is exhausted.
    for (let page = 1; page <= 5 && questions.length < count; page++) {
      if (searching)
        params.set(
          type === "tossup" ? "tossupPagination" : "bonusPagination",
          String(page),
        );
      const data = await qbreader(
        searching ? "query" : `random-${type}`,
        params,
      );
      const group = data[type === "tossup" ? "tossups" : "bonuses"];
      const raw = searching
        ? (group as { questionArray?: unknown[] })?.questionArray
        : group;
      if (!Array.isArray(raw))
        throw new Error(
          "QBReader returned an unexpected response. Please retry.",
        );
      for (const value of raw) {
        if (!value || typeof value !== "object") continue;
        const question = normalizeQuestion(value, type);
        if (
          question &&
          !seen.has(question.id) &&
          questions.length < count &&
          (!assignment || matchesAssignment(question, assignment.data))
        ) {
          seen.add(question.id);
          questions.push(question);
        }
      }
      if (raw.length < 100 && (searching || !assignment)) break;
    }
    if (assignment && account)
      return Response.json(
        await createAssignmentSession(
          account.db,
          account.uid,
          assignment.binding,
          questions,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    const sessionId =
      account && questions.length
        ? await createPracticeSession(account.db, account.uid, questions)
        : null;
    return Response.json(
      { questions, sessionId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : error instanceof SyntaxError
              ? "Invalid request."
              : error instanceof Error && error.name !== "TimeoutError"
                ? error.message
                : "QBReader timed out. Please retry.",
      },
      {
        status:
          error instanceof PracticeError
            ? error.status
            : error instanceof SyntaxError
              ? 400
              : 502,
      },
    );
  }
}
