import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-quizbowl",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
});
after(async () => {
  await env?.cleanup();
});
const profile = () => ({
  displayName: "Student",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
const ownerDb = () => env.authenticatedContext("student-one").firestore();

const verifiedDb = (
  uid = "student-one",
  email = "student@example.com",
  verified = true,
) =>
  env
    .authenticatedContext(uid, { email, email_verified: verified })
    .firestore();
async function seedStaff(uid = "admin", role = "admin", teamId = "team-a") {
  await env.withSecurityRulesDisabled(async (context) =>
    setDoc(doc(context.firestore(), "staff", uid), { role, teamId }),
  );
}
async function seedMember(teamId = "team-a", uid = "student-one") {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "teams", teamId), {
      displayName: teamId,
    });
    await setDoc(doc(context.firestore(), "teams", teamId, "members", uid), {
      displayName: "Student",
      joinedAt: Timestamp.fromMillis(0),
      updatedAt: Timestamp.fromMillis(0),
    });
  });
}

test("owner can create, read and update their own profile", async () => {
  const ref = doc(ownerDb(), "users/student-one");
  await assertSucceeds(setDoc(ref, profile()));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(
    updateDoc(ref, { displayName: "New name", updatedAt: serverTimestamp() }),
  );
});
test("anonymous access is denied", async () => {
  const ref = doc(
    env.unauthenticatedContext().firestore(),
    "users/student-one",
  );
  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, profile()));
});
test("another user cannot read or write an owner's profile", async () => {
  await setDoc(doc(ownerDb(), "users/student-one"), profile());
  const ref = doc(
    env.authenticatedContext("student-two").firestore(),
    "users/student-one",
  );
  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, profile()));
});
test("clients cannot grant themselves privileged roles", async () => {
  const ref = doc(ownerDb(), "users/student-one");
  await assertFails(setDoc(ref, { ...profile(), role: "admin" }));
  await setDoc(ref, profile());
  await assertFails(
    updateDoc(ref, { role: "teacher", updatedAt: serverTimestamp() }),
  );
});
test("malformed profiles and forged timestamps are denied", async () => {
  const ref = doc(ownerDb(), "users/student-one");
  await assertFails(setDoc(ref, { ...profile(), displayName: "" }));
  await assertFails(setDoc(ref, { ...profile(), displayName: "x".repeat(81) }));
  await assertFails(setDoc(ref, { ...profile(), createdAt: new Date(0) }));
  await setDoc(ref, profile());
  await assertFails(
    updateDoc(ref, {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});
test("collection listing, deletes, and unimplemented collections are denied", async () => {
  const db = ownerDb();
  await setDoc(doc(db, "users/student-one"), profile());
  await assertFails(getDocs(collection(db, "users")));
  await assertFails(deleteDoc(doc(db, "users/student-one")));
  await assertFails(setDoc(doc(db, "attempts/one"), { answer: "test" }));
});

test("legacy profiles can upgrade; profile and preference schemas reject bad values", async () => {
  const ref = doc(ownerDb(), "users/student-one");
  await setDoc(ref, profile());
  await assertSucceeds(
    updateDoc(ref, {
      bio: "Science",
      grade: "10",
      preferences: { theme: "dark", reducedMotion: true },
      updatedAt: serverTimestamp(),
    }),
  );
  for (const fields of [
    { displayName: "   " },
    { bio: "x".repeat(301) },
    { grade: "invalid" },
    { preferences: { theme: "invalid", reducedMotion: true } },
    { preferences: { theme: "light", reducedMotion: "yes" } },
    { preferences: { theme: "light", reducedMotion: false, role: "admin" } },
    { preferences: "dark" },
  ]) {
    await assertFails(
      updateDoc(ref, { ...fields, updatedAt: serverTimestamp() }),
    );
  }
});
test("staff assignments cannot be forged, changed, listed or read by other users", async () => {
  await seedStaff();
  const db = verifiedDb("admin", "admin@example.com");
  await assertSucceeds(getDoc(doc(db, "staff/admin")));
  await assertFails(
    setDoc(doc(ownerDb(), "staff/student-one"), {
      role: "admin",
      teamId: "team-a",
    }),
  );
  await assertFails(updateDoc(doc(db, "staff/admin"), { teamId: "team-b" }));
  await assertFails(getDoc(doc(ownerDb(), "staff/admin")));
  await assertFails(getDocs(collection(db, "staff")));
});
test("automatic memberships are server-only and cannot be forged or removed", async () => {
  await seedMember();
  await seedStaff();
  for (const db of [
    ownerDb(),
    verifiedDb("admin"),
    env.unauthenticatedContext().firestore(),
  ]) {
    await assertFails(
      setDoc(doc(db, "teams/team-b/members/student-one"), {
        displayName: "Student",
      }),
    );
    await assertFails(deleteDoc(doc(db, "teams/team-a/members/student-one")));
    await assertFails(
      setDoc(doc(db, "teams/team-a"), { displayName: "Forged" }),
    );
    await assertFails(
      setDoc(doc(db, "memberships/student-one"), { teamId: "team-b" }),
    );
    await assertFails(
      setDoc(doc(db, "invitations/new"), { email: "student@example.com" }),
    );
  }
});
test("unverified students can read their membership but not other students or rosters", async () => {
  await seedMember();
  await seedMember("team-a", "student-two");
  const db = ownerDb();
  await assertSucceeds(getDoc(doc(db, "teams/team-a/members/student-one")));
  await assertSucceeds(getDoc(doc(db, "teams/team-a")));
  await assertFails(getDoc(doc(db, "teams/team-a/members/student-two")));
  await assertFails(getDocs(collection(db, "teams/team-a/members")));
  await assertFails(getDocs(collection(db, "teams")));
  await assertFails(getDoc(doc(db, "teams/team-b")));
});
test("verified staff see only their school's roster and no private profiles", async () => {
  await seedMember();
  await seedMember("team-b", "student-two");
  await seedStaff("teacher", "teacher");
  const db = verifiedDb("teacher");
  await assertSucceeds(getDocs(collection(db, "teams/team-a/members")));
  await assertSucceeds(getDoc(doc(db, "teams/team-a/members/student-one")));
  await assertFails(getDocs(collection(db, "teams/team-b/members")));
  await assertFails(getDoc(doc(db, "teams/team-b/members/student-two")));
  await assertFails(getDoc(doc(db, "users/student-one")));
  await assertFails(
    getDocs(
      collection(
        verifiedDb("teacher", "teacher@example.com", false),
        "teams/team-a/members",
      ),
    ),
  );
});
test("roster names track private profiles without allowing membership or role changes", async () => {
  await seedMember();
  const db = ownerDb();
  await setDoc(doc(db, "users/student-one"), profile());
  const ref = doc(db, "teams/team-a/members/student-one");
  await assertFails(
    updateDoc(ref, {
      displayName: "Forged name",
      updatedAt: serverTimestamp(),
    }),
  );
  const batch = writeBatch(db);
  batch.update(doc(db, "users/student-one"), {
    displayName: "New name",
    updatedAt: serverTimestamp(),
  });
  batch.update(ref, { displayName: "New name", updatedAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
  for (const fields of [
    { role: "admin" },
    { teamId: "team-b" },
    { joinedAt: serverTimestamp() },
    { bio: "Private" },
  ])
    await assertFails(
      updateDoc(ref, { ...fields, updatedAt: serverTimestamp() }),
    );
});

test("attempts are owner-readable and cannot be forged, changed or deleted by clients", async () => {
  const path = "users/student-one/attempts/session_0_0";
  await env.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), path), {
      questionId: "q1",
      outcome: "correct",
      submittedAnswer: "DNA",
    }),
  );
  await assertSucceeds(getDoc(doc(ownerDb(), path)));
  await assertSucceeds(
    getDocs(collection(ownerDb(), "users/student-one/attempts")),
  );
  await assertFails(
    getDoc(doc(env.unauthenticatedContext().firestore(), path)),
  );
  await assertFails(
    getDoc(doc(env.authenticatedContext("student-two").firestore(), path)),
  );
  await seedStaff("admin");
  await assertFails(getDoc(doc(verifiedDb("admin"), path)));
  await assertFails(
    setDoc(doc(ownerDb(), "users/student-one/attempts/forged"), {
      outcome: "correct",
    }),
  );
  await assertFails(updateDoc(doc(ownerDb(), path), { outcome: "correct" }));
  await assertFails(deleteDoc(doc(ownerDb(), path)));
});

test("canonical practice sessions cannot be accessed or modified by clients", async () => {
  const ref = doc(
    ownerDb(),
    "users/student-one/practiceSessions/test-session/questions/0",
  );
  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, { answers: ["forged answer"] }));
});

test("submission receipts cannot be read, forged or deleted by browser clients", async () => {
  const path = "users/student-one/attemptSubmissions/test-request";
  await env.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), path), { attemptId: "session_0_0" }),
  );
  for (const db of [
    ownerDb(),
    env.authenticatedContext("student-two").firestore(),
    env.unauthenticatedContext().firestore(),
  ]) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(
      getDocs(collection(db, "users/student-one/attemptSubmissions")),
    );
    await assertFails(setDoc(doc(db, path), { attemptId: "forged" }));
    await assertFails(deleteDoc(doc(db, path)));
  }
});

test("private decks, shared deck cards and share pointers remain server-only", async () => {
  const paths = [
    "users/student-one/decks/private-deck",
    "users/student-one/decks/private-deck/questions/card",
    "users/student-one/decks/shared-deck",
    "users/student-one/decks/shared-deck/questions/card",
    "teams/team-a/sharedDecks/share-pointer",
  ];
  await env.withSecurityRulesDisabled(async (context) => {
    for (const path of paths)
      await setDoc(doc(context.firestore(), path), {
        visibility: "team",
        teamId: "team-a",
      });
    await setDoc(doc(context.firestore(), "teams/team-a/members/student-two"), {
      displayName: "Teammate",
    });
  });
  await seedStaff("admin");
  for (const db of [
    ownerDb(),
    env.authenticatedContext("student-two").firestore(),
    verifiedDb("admin"),
    env.unauthenticatedContext().firestore(),
  ]) {
    for (const path of paths) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { visibility: "team" }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    await assertFails(getDocs(collection(db, "teams/team-a/sharedDecks")));
  }
});

test("staff statistics and review receipts require server APIs; clients cannot forge progress", async () => {
  await seedStaff();
  await seedMember();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users/student-one/studyReviews/review"), {
      completedAt: Timestamp.now(),
    });
    await setDoc(doc(db, "teams/team-a/assignments/a/progress/student-one"), {
      completedQuestions: 5,
    });
    await setDoc(doc(db, "users/student-one/attempts/attempt"), {
      outcome: "correct",
    });
  });
  for (const db of [
    verifiedDb(),
    verifiedDb("admin"),
    verifiedDb("student-two"),
    env.unauthenticatedContext().firestore(),
  ]) {
    for (const path of [
      "users/student-one/studyReviews/review",
      "teams/team-a/assignments/a/progress/student-one",
    ]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(
        setDoc(doc(db, path), {
          completedQuestions: 999,
          completedAt: serverTimestamp(),
        }),
      );
    }
  }
  await assertFails(
    getDoc(doc(verifiedDb("admin"), "users/student-one/attempts/attempt")),
  );
  await assertSucceeds(
    getDoc(doc(verifiedDb(), "users/student-one/attempts/attempt")),
  );
});
