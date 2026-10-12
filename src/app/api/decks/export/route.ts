import {
  authenticatePractice,
  PracticeError,
} from "@/lib/server/practice-persistence";
import { exportDeck } from "@/lib/server/decks";
import { ankiPackage } from "@/lib/server/anki-package";
import { exportRows, type ExportOptions } from "@/lib/anki-export";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };

export async function POST(request: Request) {
  try {
    const account = (await authenticatePractice(request))!;
    const text = await request.text();
    if (text.length > 4096)
      throw new PracticeError("Export request too large.", 413);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new PracticeError("Invalid export request.", 400);
    const options: ExportOptions = body.options || {};
    if (
      typeof options !== "object" ||
      Array.isArray(options) ||
      ![undefined, "questions", "identifiers"].includes(options.kind) ||
      (options.category !== undefined &&
        (typeof options.category !== "string" ||
          options.category.length > 100)) ||
      (options.difficulty !== undefined &&
        (typeof options.difficulty !== "string" ||
          !/^(|[0-9]|10)$/.test(options.difficulty))) ||
      ![undefined, "", "simple", "intermediate", "complex"].includes(
        options.complexity,
      )
    )
      throw new PracticeError("Invalid export filters.", 400);
    const { deck, key } = await exportDeck(
      account.db,
      account.uid,
      body.deckId,
      body.sharedId,
    );
    const rows = exportRows(deck, options);
    if (!rows.length)
      throw new PracticeError("No saved cards match the export filters.", 400);
    if (rows.length > 5000 || JSON.stringify(rows).length > 16 * 1024 * 1024)
      throw new PracticeError(
        "Export is too large. Choose narrower filters.",
        413,
      );
    const data = await ankiPackage(deck.name, key, rows);
    return new Response(new Uint8Array(data), {
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="quizbowl.apkg"',
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : error instanceof SyntaxError
              ? "Invalid export request."
              : "The Anki package could not be exported. Please retry.",
      },
      {
        status:
          error instanceof PracticeError
            ? error.status
            : error instanceof SyntaxError
              ? 400
              : 503,
        headers,
      },
    );
  }
}
