import { qbreader } from "@/lib/server/qbreader";
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object")
      return Response.json({ error: "Invalid request." }, { status: 400 });
    const { answerline, givenAnswer } = body;
    if (
      typeof answerline !== "string" ||
      !answerline.trim() ||
      answerline.length > 20000 ||
      typeof givenAnswer !== "string" ||
      !givenAnswer.trim() ||
      givenAnswer.length > 500
    )
      return Response.json(
        { error: "Enter an answer of up to 500 characters." },
        { status: 400 },
      );
    const result = await qbreader(
      "check-answer",
      new URLSearchParams({ answerline, givenAnswer: givenAnswer.trim() }),
    );
    if (!["accept", "reject", "prompt"].includes(String(result.directive)))
      throw new Error("QBReader returned an unexpected verdict. Please retry.");
    return Response.json({
      directive: result.directive,
      directedPrompt:
        typeof result.directedPrompt === "string"
          ? result.directedPrompt
          : null,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof SyntaxError
            ? "Invalid request."
            : error instanceof Error && error.name !== "TimeoutError"
              ? error.message
              : "Answer checking timed out. Please retry.",
      },
      { status: error instanceof SyntaxError ? 400 : 502 },
    );
  }
}
