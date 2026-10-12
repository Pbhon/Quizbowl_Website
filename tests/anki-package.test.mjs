import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unzipSync } from "fflate";
import { exporter, packager, fixtureDeck } from "./helpers/anki-fixture.mjs";

test("APKG contains a valid Anki database, original answers, tags and new unscheduled cards", async () => {
  const dir = await mkdtemp(join(tmpdir(), "anki-check-"));
  let db;
  try {
    const rows = exporter.exportRows(fixtureDeck);
    const archive = unzipSync(
      await packager.ankiPackage(fixtureDeck.name, "owner/deck", rows),
    );
    assert.deepEqual(Object.keys(archive).sort(), [
      "collection.anki2",
      "media",
    ]);
    assert.equal(Buffer.from(archive.media).toString(), "{}");
    const path = join(dir, "collection.anki2");
    await writeFile(path, archive["collection.anki2"]);
    db = new DatabaseSync(path);
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    const notes = db.prepare("SELECT * FROM notes ORDER BY guid").all();
    assert.equal(notes.length, 2);
    assert.deepEqual(
      notes.map((note) => note.guid),
      Array.from(rows, (row) => row.noteId),
    );
    notes.forEach((note, i) => {
      assert.deepEqual(note.flds.split("\x1f"), [
        rows[i].noteId,
        rows[i].front,
        rows[i].back,
      ]);
      assert.ok(note.tags.includes("topic::cell%20biology"));
    });
    const model = Object.values(
      JSON.parse(db.prepare("SELECT models FROM col").get().models),
    )[0];
    assert.equal(model.name, "QuizBowl v1");
    assert.equal(model.tmpls[0].qfmt, "{{Front}}");
    assert.ok(!model.tmpls[0].afmt.includes("{{ID}}"));
    assert.ok(
      db
        .prepare("SELECT * FROM cards")
        .all()
        .every(
          (card) => card.type === 0 && card.queue === 0 && card.reps === 0,
        ),
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM revlog").get().n, 0);
    assert.ok((await readFile(path)).length > 0);
  } finally {
    db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
