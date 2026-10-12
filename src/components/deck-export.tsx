"use client";

import { useState } from "react";
import type { StudyDeck } from "@/lib/decks";
import { ankiCSV, exportRows, type ExportOptions } from "@/lib/anki-export";
import { FormField, Notice } from "./form-field";
import { Button } from "./ui/button";

export function DeckExport({ deck }: { deck: StudyDeck }) {
  const [options, setOptions] = useState<ExportOptions>({ kind: "questions" });
  const prefix = `export-${deck.id}`;
  const rows = exportRows(deck, options);
  const [error, setError] = useState("");
  function download() {
    setError("");
    let url: string | undefined;
    const anchor = document.createElement("a");
    try {
      url = URL.createObjectURL(
        new Blob([ankiCSV(rows)], { type: "text/csv;charset=utf-8" }),
      );
      anchor.href = url;
      anchor.download = `${
        deck.name
          .replace(/[^\p{L}\p{N} _-]/gu, "_")
          .trim()
          .slice(0, 80) || "study-deck"
      }-${options.kind || "questions"}.csv`;
      document.body.append(anchor);
      anchor.click();
    } catch {
      setError("The CSV could not be downloaded. Please retry.");
    } finally {
      anchor.remove();
      if (url) {
        const downloadURL = url;
        window.setTimeout(() => URL.revokeObjectURL(downloadURL), 1000);
      }
    }
  }
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">
        Export to Anki CSV
      </summary>
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
        <Button disabled={!rows.length} onClick={download}>
          Download Anki CSV
        </Button>
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
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>
              Download the CSV, then open Anki on your computer and choose File
              → Import.
            </li>
            <li>
              Select the CSV and choose your destination deck and the Basic note
              type.
            </li>
            <li>
              Map Front to Front, Back to Back, and Tags to Tags. Use comma
              separation and enable HTML in fields; current Anki versions read
              these settings from the file headers.
            </li>
            <li>Preview the cards and select Import.</li>
          </ol>
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
