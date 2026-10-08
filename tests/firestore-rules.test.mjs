import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-quizbowl", firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") } });
});
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await env?.cleanup(); });
const profile = () => ({ displayName: "Student", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const ownerDb = () => env.authenticatedContext("student-one").firestore();

test("owner can create, read and update their own profile", async () => {
  const ref = doc(ownerDb(), "users/student-one");
  await assertSucceeds(setDoc(ref, profile()));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(updateDoc(ref, { displayName: "New name", updatedAt: serverTimestamp() }));
});
test("anonymous access is denied", async () => {
  const ref = doc(env.unauthenticatedContext().firestore(), "users/student-one");
  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, profile()));
});
test("another user cannot read or write an owner's profile", async () => {
  await setDoc(doc(ownerDb(), "users/student-one"), profile());
  const ref = doc(env.authenticatedContext("student-two").firestore(), "users/student-one");
  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, profile()));
});
test("clients cannot grant themselves privileged roles", async () => {
  const ref = doc(ownerDb(), "users/student-one");
  await assertFails(setDoc(ref, { ...profile(), role: "admin" }));
  await setDoc(ref, profile());
  await assertFails(updateDoc(ref, { role: "teacher", updatedAt: serverTimestamp() }));
});
test("malformed profiles and forged timestamps are denied", async () => {
  const ref = doc(ownerDb(), "users/student-one");
  await assertFails(setDoc(ref, { ...profile(), displayName: "" }));
  await assertFails(setDoc(ref, { ...profile(), displayName: "x".repeat(81) }));
  await assertFails(setDoc(ref, { ...profile(), createdAt: new Date(0) }));
  await setDoc(ref, profile());
  await assertFails(updateDoc(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});
test("collection listing, deletes, and unimplemented collections are denied", async () => {
  const db = ownerDb();
  await setDoc(doc(db, "users/student-one"), profile());
  await assertFails(getDocs(collection(db, "users")));
  await assertFails(deleteDoc(doc(db, "users/student-one")));
  await assertFails(setDoc(doc(db, "attempts/one"), { answer: "test" }));
});
