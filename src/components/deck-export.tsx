"use client";

import { useState } from "react";
import type { StudyDeck } from "@/lib/decks";
import { exportRows, type ExportOptions } from "@/lib/anki-export";
import { FormField } from "./form-field";

export function DeckExport({ deck }: { deck: StudyDeck }) {
  const [options, setOptions] = useState<ExportOptions>({ kind: "questions" });
  const prefix = `export-${deck.id}`;
  const rows = exportRows(deck, options);
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">Export to Anki CSV</summary>
      <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField id={`${prefix}-kind`} label="Export card type">
            <select id={`${prefix}-kind`} className="form-select" value={options.kind} onChange={(e) => setOptions({ ...options, kind: e.target.value as ExportOptions["kind"] })}>
              <option value="questions">Full questions</option>
              <option value="identifiers">Saved AI identifiers</option>
            </select>
          </FormField>
          <FormField id={`${prefix}-category`} label="Export category">
            <select id={`${prefix}-category`} className="form-select" value={options.category || ""} onChange={(e) => setOptions({ ...options, category: e.target.value })}>
              <option value="">All categories</option>
              {[...new Set(deck.cards.map((card) => card.originalQuestion.category))].sort().filter(Boolean).map((category) => <option key={category}>{category}</option>)}
            </select>
          </FormField>
          <FormField id={`${prefix}-difficulty`} label="Export difficulty">
            <select id={`${prefix}-difficulty`} className="form-select" value={options.difficulty || ""} onChange={(e) => setOptions({ ...options, difficulty: e.target.value })}>
              <option value="">All difficulties</option>
              {Array.from({ length: 11 }, (_, i) => <option key={i} value={String(i)}>{i}</option>)}
            </select>
          </FormField>
          {options.kind === "identifiers" && <FormField id={`${prefix}-complexity`} label="Clue complexity">
            <select id={`${prefix}-complexity`} className="form-select" value={options.complexity || ""} onChange={(e) => setOptions({ ...options, complexity: e.target.value as ExportOptions["complexity"] })}>
              <option value="">All complexities</option>
              <option value="simple">Simple / giveaway</option>
              <option value="intermediate">Intermediate</option>
              <option value="complex">Complex / early buzzer</option>
            </select>
          </FormField>}
        </div>
        <p role="status">{rows.length} cards match the export filters.</p>
        {options.kind === "identifiers" && !rows.length && <p>No saved AI identifiers match. AI generation is not available yet.</p>}
      </div>
    </details>
  );
}
