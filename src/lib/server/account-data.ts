import "server-only";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { PracticeError } from "./practice-persistence";

export function requireRecentAuthentication(
  authTime: number,
  now = Date.now(),
) {
  if (
    !Number.isFinite(authTime) ||
    authTime <= 0 ||
    now / 1000 - authTime > 300 ||
    authTime > now / 1000 + 60
  )
    throw new PracticeError(
      "Sign in again before downloading data or requesting deletion.",
      401,
    );
}
/** Only authenticated-owner references can enter this traversal. No caller paths. */
export async function exportAccountData(db: Firestore, uid: string) {
  const records: { path: string; data: unknown }[] = [];
  let bytes = 0;
  async function visit(ref: DocumentReference) {
    const snapshot = await ref.get();
    if (snapshot.exists) {
      const record = { path: ref.path, data: snapshot.data() };
      bytes += Buffer.byteLength(JSON.stringify(record), "utf8");
      if (records.length >= 5000 || bytes > 16 * 1024 * 1024)
        throw new PracticeError(
          "Your export needs school operator assistance because of its size.",
          413,
        );
      records.push(record);
    }
    // listDocuments also finds missing parent documents with surviving children.
    for (const collection of await ref.listCollections())
      for (const child of await collection.listDocuments()) await visit(child);
  }
  await visit(db.doc(`users/${uid}`));
  await visit(db.doc(`staff/${uid}`));
  await visit(db.doc(`memberships/${uid}`));
  await visit(db.doc(`privacyJobs/${uid}`));
  for (const team of await db.collection("teams").listDocuments()) {
    await visit(team.collection("members").doc(uid));
    for (const assignment of await team
      .collection("assignments")
      .listDocuments())
      await visit(assignment.collection("progress").doc(uid));
    for (const event of await team.collection("events").listDocuments())
      await visit(event.collection("rsvps").doc(uid));
  }
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), records };
}
export async function requestAccountDeletion(db: Firestore, uid: string) {
  const ref = db.doc(`privacyJobs/${uid}`);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) return { status: snapshot.data()!.status };
    tx.create(ref, {
      status: "requested",
      requestedAt: FieldValue.serverTimestamp(),
    });
    return { status: "requested" };
  });
}
