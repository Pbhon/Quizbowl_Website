"""Exercise the official Anki importer/rendering backend in temporary collections."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from anki.collection import Collection
from anki import import_export_pb2 as pb

FIXTURES = Path(sys.argv.pop(1)).resolve()


class AnkiImports(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="quizbowl-anki-tests-", dir=FIXTURES)
        self.col = Collection(str(Path(self.tmp.name) / "collection.anki2"))

    def tearDown(self):
        self.col.close()
        self.tmp.cleanup()

    def package(self, name):
        return self.col.import_anki_package(pb.ImportAnkiPackageRequest(
            package_path=str(FIXTURES / name),
            options=pb.ImportAnkiPackageOptions(
                update_notes=pb.IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_ALWAYS,
                update_notetypes=pb.IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_NEVER,
                with_scheduling=False,
            ),
        ))

    def csv(self, name):
        path = str(FIXTURES / name)
        metadata = self.col.get_csv_metadata(path, None)
        self.assertTrue(metadata.is_html)
        self.assertEqual(metadata.guid_column, 5)
        return self.col.import_csv(pb.ImportCsvRequest(path=path, metadata=metadata))

    def assert_rows(self, name):
        expected = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
        self.assertEqual(self.col.note_count(), len(expected))
        self.assertEqual(len(self.col.find_cards("")), len(expected))
        for row in expected:
            nid = self.col.db.scalar("select id from notes where guid=?", row["noteId"])
            self.assertIsNotNone(nid)
            note = self.col.get_note(nid)
            self.assertEqual(list(note.fields), [row["noteId"], row["front"], row["back"]])
            self.assertTrue(set(row["tags"].split()).issubset(set(note.tags)))
            card = note.cards()[0]
            self.assertIn(row["front"], card.question())
            self.assertIn(row["back"], card.answer())
            self.assertNotIn(row["noteId"], card.question())
            self.assertNotIn(row["noteId"], card.answer())

    def test_apkg_reimport_edits_filters_and_scheduling(self):
        self.package("original.apkg")
        self.assert_rows("original.json")
        self.package("original.apkg")
        self.assert_rows("original.json")
        # Anki's package revision timestamps have whole-second precision.
        self.package("same-second.apkg")
        self.assert_rows("original.json")
        card = self.col.get_card(self.col.find_cards("")[0])
        card.type, card.queue, card.reps, card.ivl, card.due = 2, 2, 7, 15, 100
        self.col.update_card(card)
        self.package("modified.apkg")
        self.assert_rows("modified.json")
        preserved = self.col.get_card(card.id)
        self.assertEqual((preserved.type, preserved.queue, preserved.reps, preserved.ivl, preserved.due), (2, 2, 7, 15, 100))
        self.package("filtered.apkg")
        self.assertEqual(self.col.note_count(), 4)
        self.assertEqual(len(self.col.find_cards("")), 4)

    def test_csv_after_apkg_and_reimports(self):
        self.package("original.apkg")
        self.csv("original.csv")
        self.assert_rows("original.json")
        self.csv("modified.csv")
        self.assert_rows("modified.json")
        self.csv("modified.csv")
        self.assert_rows("modified.json")

    def test_csv_first_then_apkg(self):
        # Install the shipped schema, then start with an empty collection of notes.
        self.package("original.apkg")
        self.col.remove_notes(self.col.find_notes(""))
        self.assertEqual(self.col.note_count(), 0)
        self.csv("original.csv")
        self.assert_rows("original.json")
        self.package("modified.apkg")
        self.assert_rows("modified.json")


if __name__ == "__main__":
    unittest.main(verbosity=2)
