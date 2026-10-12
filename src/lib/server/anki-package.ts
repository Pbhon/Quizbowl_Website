import "server-only";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { ANKI_NOTE_TYPE, type ExportRow } from "@/lib/anki-export";

export const MODEL_ID = 1896384221001;
const schema = `
CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL);
CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL);
CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
CREATE INDEX ix_notes_csum ON notes(csum);
CREATE INDEX ix_cards_nid ON cards(nid);
CREATE INDEX ix_cards_sched ON cards(did,queue,due);
`;

/** Legacy schema-11 APKG, supported by current Anki; no media or review history. */
export async function ankiPackage(
  name: string,
  deckKey: string,
  rows: ExportRow[],
) {
  if (!rows.length || rows.length > 5000)
    throw new Error("Export 1–5000 notes.");
  const directory = await mkdtemp(join(tmpdir(), "quizbowl-anki-"));
  let db: DatabaseSync | undefined;
  try {
    const path = join(directory, "collection.anki2");
    db = new DatabaseSync(path);
    db.exec(schema);
    const now = Date.now(),
      seconds = Math.floor(now / 1000);
    const deckId =
      parseInt(
        createHash("sha256").update(deckKey).digest("hex").slice(0, 13),
        16,
      ) || 2;
    const model = {
      id: MODEL_ID,
      name: ANKI_NOTE_TYPE,
      type: 0,
      mod: 1700000000,
      usn: -1,
      sortf: 1,
      did: null,
      flds: ["ID", "Front", "Back"].map((field, ord) => ({
        name: field,
        ord,
        id: MODEL_ID + ord + 1,
        sticky: false,
        rtl: false,
        font: "Arial",
        size: 20,
        description: "",
      })),
      tmpls: [
        {
          name: "Question",
          ord: 0,
          id: MODEL_ID + 4,
          qfmt: "{{Front}}",
          afmt: '{{FrontSide}}<hr id="answer">{{Back}}',
          bqfmt: "",
          bafmt: "",
          did: null,
        },
      ],
      css: ".card { font-family: Arial, sans-serif; font-size: 20px; line-height: 1.5; text-align: left; overflow-wrap: anywhere; } small { font-size: 75%; }",
      latexPre: "",
      latexPost: "",
      latexsvg: false,
      req: [[0, "any", [1]]],
    };
    const deck = (id: number, deckName: string) => ({
      id,
      name: deckName,
      mod: seconds,
      usn: -1,
      desc: "",
      dyn: 0,
      conf: 1,
      extendNew: 0,
      extendRev: 0,
      collapsed: false,
      browserCollapsed: false,
      newToday: [0, 0],
      revToday: [0, 0],
      lrnToday: [0, 0],
      timeToday: [0, 0],
    });
    // Sanitize Anki's hierarchy separator so a user name cannot create nested decks.
    const deckName = `QuizBowl::${
      name
        .replace(/::/g, " — ")
        .replace(/[\x00-\x1f]/g, " ")
        .trim() || "Study deck"
    }`;
    db.prepare("INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      1,
      seconds,
      now,
      now,
      11,
      0,
      -1,
      0,
      JSON.stringify({ nextPos: rows.length + 1, schedVer: 2 }),
      JSON.stringify({ [MODEL_ID]: model }),
      JSON.stringify({
        1: deck(1, "Default"),
        [deckId]: deck(deckId, deckName),
      }),
      "{}",
      "{}",
    );
    const note = db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const card = db.prepare(
      "INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    db.exec("BEGIN");
    rows.forEach((row, index) => {
      const id = now + index;
      const clean = (value: string) => value.replace(/[\x00\x1f]/g, "");
      const checksum = parseInt(
        createHash("sha1").update(row.noteId).digest("hex").slice(0, 8),
        16,
      );
      note.run(
        id,
        row.noteId,
        MODEL_ID,
        seconds,
        -1,
        ` ${row.tags} `,
        [row.noteId, row.front, row.back].map(clean).join("\x1f"),
        clean(row.front.replace(/<[^>]*>/g, "")),
        checksum,
        0,
        "",
      );
      card.run(
        id,
        id,
        deckId,
        0,
        seconds,
        -1,
        0,
        0,
        index + 1,
        0,
        2500,
        0,
        0,
        0,
        0,
        0,
        0,
        "",
      );
    });
    db.exec("COMMIT");
    db.close();
    db = undefined;
    return zipSync(
      {
        "collection.anki2": new Uint8Array(await readFile(path)),
        media: strToU8("{}"),
      },
      { level: 6 },
    );
  } finally {
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
