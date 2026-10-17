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

## Clue cache

`aiClueCache/{sha256}` is server-only. Keys bind prompt version, configured model,
question type/ID, complete original text and official answers. Validated identifier
cards bind to an original part and verbatim excerpt. The model cannot replace the
official answer. Cache documents contain no student answers, notes, tags or IDs.
The generation service below owns cache states and concurrency leases.

## Daily statistics

`users/{uid}/dailyStatistics/{YYYY-MM-DD}` stores UTC day, schema version,
responses, distinct session questions and correct/incorrect/skipped counts.
Missing outcome fields mean zero. Nested question markers deduplicate bonus parts
per day. Summary updates, markers, attempts, receipts, session totals and assignment
credit commit in one transaction. Prompts and retries add nothing. These server-only
summaries start with this release; existing dashboards continue reading complete
history to preserve historical coverage and the viewer's timezone.
