# Backend collections and operations

Task 12 covers the High items only. Existing feature collections are reused.

## Attempt history

`users/{uid}/attempts/{sessionId}_{questionIndex}_{part}` stores the canonical
question snapshot, submitted answers, clarification trail, outcome and server
timestamps. Only the owner can read history directly; all client writes and all
other accounts' reads are denied. Even school staff must use the authorized,
school-scoped dashboard, which returns statistics instead of private answers.
Canonical session questions and account-scoped submission receipts are server-only.
The server derives answer lines from those question records, never from submitted
answer lines, scores, user IDs or role claims. History cursors resolve within the
authenticated owner's collection.

Validation: history and practice-persistence unit suites cover owner-scoped reads,
input validation, clarification trails and atomic recording. The Firestore rules
suite exercises owner reads, forgery, mutation, deletion and cross-account denial.
