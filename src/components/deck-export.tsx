"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { StudyDeck } from "@/lib/decks";
import { ankiCSV, exportRows, type ExportOptions } from "@/lib/anki-export";
import { FormField, Notice } from "./form-field";
import { Button } from "./ui/button";

export function DeckExport({ deck, user }: { deck: StudyDeck; user: User }) {
  const [options, setOptions] = useState<ExportOptions>({ kind: "questions" });
  const prefix = `export-${deck.id}`;
  const rows = exportRows(deck, options);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function download(format: "csv" | "apkg") {
    if (controller.current) return;
    const pending = new AbortController();
    controller.current = pending;
    setError("");
    setBusy(true);
    let url: string | undefined;
    const anchor = document.createElement("a");
    try {
      let blob: Blob;
      if (format === "apkg") {
        const response = await fetch("/api/decks/export", {
          method: "POST",
          signal: pending.signal,
          headers: {
            Authorization: `Bearer ${await user.getIdToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(deck.sharedId
              ? { sharedId: deck.sharedId }
              : { deckId: deck.id }),
            options,
          }),
        });
        if (!response.ok)
          throw new Error(
            (await response.json()).error || "Export failed. Please retry.",
          );
        blob = await response.blob();
      } else
        blob = new Blob([ankiCSV(rows)], { type: "text/csv;charset=utf-8" });
      if (pending.signal.aborted) return;
      url = URL.createObjectURL(blob);
      anchor.href = url;
      anchor.download = `${
        deck.name
          .replace(/[^\p{L}\p{N} _-]/gu, "_")
          .trim()
          .slice(0, 80) || "study-deck"
      }-${options.kind || "questions"}.${format}`;
      document.body.append(anchor);
      anchor.click();
    } catch (failure) {
      if (!pending.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "The export could not be downloaded. Please retry.",
        );
    } finally {
      controller.current = null;
      if (!pending.signal.aborted) setBusy(false);
      anchor.remove();
      if (url) {
        const downloadURL = url;
        window.setTimeout(() => URL.revokeObjectURL(downloadURL), 1000);
      }
    }
  }
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">Export to Anki</summary>
      <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField id={`${prefix}-kind`} label="Export card type">
            <select
              id={`${prefix}-kind`}
              className="form-select"
              value={options.kind}
              onChange={(e) =>
                setOptions({
                  ...options,
                  kind: e.target.value as ExportOptions["kind"],
                })
              }
            >
              <option value="questions">Full questions</option>
              <option value="identifiers">Saved AI identifiers</option>
            </select>
          </FormField>
          <FormField id={`${prefix}-category`} label="Export category">
            <select
              id={`${prefix}-category`}
              className="form-select"
              value={options.category || ""}
              onChange={(e) =>
                setOptions({ ...options, category: e.target.value })
              }
            >
              <option value="">All categories</option>
              {[
                ...new Set(
                  deck.cards.map((card) => card.originalQuestion.category),
                ),
              ]
                .sort()
                .filter(Boolean)
                .map((category) => (
                  <option key={category}>{category}</option>
                ))}
            </select>
          </FormField>
          <FormField id={`${prefix}-difficulty`} label="Export difficulty">
            <select
              id={`${prefix}-difficulty`}
              className="form-select"
              value={options.difficulty || ""}
              onChange={(e) =>
                setOptions({ ...options, difficulty: e.target.value })
              }
            >
              <option value="">All difficulties</option>
              {Array.from({ length: 11 }, (_, i) => (
                <option key={i} value={String(i)}>
                  {i}
                </option>
              ))}
            </select>
          </FormField>
          {options.kind === "identifiers" && (
            <FormField id={`${prefix}-complexity`} label="Clue complexity">
              <select
                id={`${prefix}-complexity`}
                className="form-select"
                value={options.complexity || ""}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    complexity: e.target.value as ExportOptions["complexity"],
                  })
                }
              >
                <option value="">All complexities</option>
                <option value="simple">Simple / giveaway</option>
                <option value="intermediate">Intermediate</option>
                <option value="complex">Complex / early buzzer</option>
              </select>
            </FormField>
          )}
        </div>
        <p role="status">{rows.length} cards match the export filters.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !rows.length}
            onClick={() => void download("apkg")}
          >
            Download Anki package
          </Button>
          <Button
            variant="outline"
            disabled={busy || !rows.length}
            onClick={() => void download("csv")}
          >
            Download Anki CSV
          </Button>
        </div>
        {busy && <Notice>Preparing download…</Notice>}
        {error && <Notice error>{error}</Notice>}
        <p className="text-sm text-muted-foreground">
          Export uses all cards in this deck and the filters above. Search in
          the deck browser does not change the export.
        </p>
        {options.kind === "identifiers" && !rows.length && (
          <p>
            No saved AI identifiers match. AI generation is not available yet.
          </p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer">How to import into Anki</summary>
          <p className="mt-2">
            Download an Anki package, then open the APKG in Anki. The QuizBowl
            v1 note type and card layout are included. To refresh previously
            imported cards, choose to always update notes; leave learning
            progress import disabled to keep your reviews.
          </p>
          <p className="mt-2">
            If a rapid edit does not refresh a note, wait a second and download
            the package again.
          </p>
          <p className="mt-2 font-medium">CSV alternative</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>
              Download the CSV, then open Anki on your computer and choose File
              → Import.
            </li>
            <li>
              Import an APKG once to install QuizBowl v1, then select that note
              type and your destination deck when importing CSV. Keep the
              shipped fields and card template unchanged so CSV and APKG can
              update the same notes.
            </li>
            <li>
              Map ID to ID, Front to Front, Back to Back, Tags to Tags, and GUID
              to the GUID column. Use comma separation and enable HTML in
              fields; current Anki versions read these settings from the file
              headers.
            </li>
            <li>Preview the cards and select Import.</li>
          </ol>
          <p className="mt-2">
            Keep ID and GUID unchanged when importing again. This preserves one
            note across deck copies and question edits.
          </p>
          <p className="mt-2">
            Existing decks saved before this feature retain their stored plain
            question text. Formatted answer lines are exported when available.
          </p>
          <a
            className="mt-2 inline-block underline"
            href="https://docs.ankiweb.net/manual/importing/text-files"
            target="_blank"
            rel="noreferrer"
          >
            Anki text import guide
          </a>
        </details>
      </div>
    </details>
  );
}
