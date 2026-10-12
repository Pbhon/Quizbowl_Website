import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  exporter,
  packager,
  fixtureDeck,
  packageClock,
} from "../tests/helpers/anki-fixture.mjs";
const destination = resolve(".tools/anki-import-fixtures");
await mkdir(destination, { recursive: true });
const modified = {
  ...fixtureDeck,
  name: "Renamed deck",
  cards: fixtureDeck.cards.map((card) => ({
    ...card,
    question: {
      ...card.question,
      parts: card.question.parts.map((part) => `${part} Edited study text.`),
    },
    tags: [...card.tags, "updated"],
    identifiers: card.identifiers.map((clue) => ({
      ...clue,
      clue: `${clue.clue} Edited clue.`,
    })),
  })),
};
for (const [name, deck] of [
  ["original", fixtureDeck],
  ["modified", modified],
]) {
  // Represent successive real exports in the past without slowing tests down.
  packageClock.now = () =>
    name === "original" ? 1700000000000 : 1700000010000;
  const rows = [
    ...exporter.exportRows(deck),
    ...exporter.exportRows(deck, { kind: "identifiers" }),
  ];
  await writeFile(
    join(destination, `${name}.apkg`),
    await packager.ankiPackage(deck.name, "fixture/source", rows),
  );
  await writeFile(join(destination, `${name}.csv`), exporter.ankiCSV(rows));
  await writeFile(join(destination, `${name}.json`), JSON.stringify(rows));
}
packageClock.now = () => 1700000020000;
const modifiedRows = [
  ...exporter.exportRows(modified),
  ...exporter.exportRows(modified, { kind: "identifiers" }),
];
packageClock.now = () => 1700000000000;
await writeFile(
  join(destination, "same-second.apkg"),
  await packager.ankiPackage(modified.name, "fixture/source", modifiedRows),
);
packageClock.now = () => 1700000020000;
await writeFile(
  join(destination, "filtered.apkg"),
  await packager.ankiPackage(
    "Filtered copy",
    "fixture/copy",
    exporter.exportRows(fixtureDeck, { difficulty: "0" }),
  ),
);
const result = spawnSync(
  process.env.ANKI_TEST_PYTHON || "python",
  ["tests/anki-imports.test.py", destination],
  { stdio: "inherit" },
);
if (result.error)
  console.error(
    "Set ANKI_TEST_PYTHON to a Python environment containing tests/anki-requirements.txt.",
    result.error.message,
  );
process.exitCode = result.status ?? 1;
