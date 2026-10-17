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

## Answer validation

`POST /api/practice/attempts` verifies a non-revoked Firebase token, validates the
session/part/reading position and loads the canonical stored judging answer.
Unknown submitted identity, answer-line and scoring fields have no authority.
Only accept/reject/prompt verdicts (or an explicit skip) are allowed. Upstream
failures write nothing. Guest `/api/practice/check-answer` never awards saved credit.

## Secure generation endpoint

`POST /api/ai/clues` accepts only `{ "deckId": "...", "cardId": "..." }`.
It requires a non-revoked token, current verified email, an owned saved card and
current teacher permissions for curated decks. It loads the original saved source,
checks permissions again before reservation and delivery, and never takes arbitrary
prompts or answers. It sends only original question text and official answers to
Gemini, excluding student identity, responses, edits, notes and tags.

Enable only by setting private `GEMINI_GENERATION_ENABLED=true`, `GEMINI_API_KEY`
and `GEMINI_MODEL` to an available model supporting structured JSON output. No live
provider calls are made by tests. The request follows Google's documented
[structured output REST contract](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en).
Provider output is independently validated before caching and attaching cards.

The shared content cache transitions generating → completed or failed. A 90-second
lease with a unique fencing token prevents concurrent duplicate workers; expired
leases can be recovered. Provider calls time out at 45 seconds. Failed attempts
cool down for one minute; another explicit endpoint request retries. Daily limits
are 20 attempts per user, 200 deployment-wide, and 10 per minute deployment-wide,
reserved in the same transaction as the lease. Failures consume quota; cache hits
do not. Usage records contain only counts and timestamps and expire after 32 days
through the retention maintenance command. A lost worker may require a later retry;
an upstream service cannot guarantee exactly-once billing after network failure.

This backend endpoint does not complete Task 7's generation UI or the skipped
Medium free-tier integration/configuration item. No ordinary fetch, answer, export
or answer-reveal path invokes generation.

## Anki endpoint

`POST /api/decks/export` exports a single owned deck or currently authorized school
share, never a caller-selected owner. Conflicting sources and unknown scope fields
are rejected. Filters and request size are validated before package generation;
exports are limited to 5,000 notes / 16 MiB of row data. Responses are private,
uncached attachments and failures hide filesystem/provider details. Existing Anki
package and import suites cover official answers, formatting and stable identities.

## API limits and caching

Next.js `src/proxy.ts` covers every `/api/*` route. It checks same-origin requests,
counts streamed bodies up to 2 MiB (individual routes can impose smaller limits),
verifies supplied Firebase tokens with revocation checking, and reserves a durable
Firestore fixed-window quota before forwarding. Failures are closed with safe JSON.
Identity comes from the verified token, never forwarded IP/user headers. Anonymous
traffic shares a deployment-wide bucket per operation; sign in for individual limits.

Per-minute limits: account data operations 3; question batches 30 per account / 20 anonymous; answers 180 per
account / 60 anonymous; Anki exports 6; generation 10; administrator registrations
20; other operations 120 per account / 30 anonymous. Signup's existing validated-code
hourly limit also remains. Limits return 429 and Retry-After; unavailable quota
storage returns 503. Hash-only bucket records expire after ten minutes via maintenance.
Even guest upstream requests require a configured backend for the durable limiter;
protected endpoints without a token return 401 before accessing Firebase.
The fixed window allows bursts at minute boundaries. All API responses are private
and uncached. Verified routes still perform their own authorization checks.

Deterministic QBReader verdicts are reused for 60 seconds in a bounded 500-entry
process cache, with concurrent request coalescing. Keys hash inputs; cached values
are copied and errors/invalid verdicts are not cached. This cache is best-effort
per instance. Random question draws are never cached. Durable AI content caching
and generation quotas are independent of this optimization.

## Rules and roles

The rules allow only validated owner profile writes, owner history reads, and
limited current-school roster access. All other client access is denied by default,
including new caches, quotas, summary markers and privacy jobs. Even verified admins
cannot directly edit these collections. Server endpoints validate Firebase identity
and load current staff/membership records; teacher/admin roles never come from
browser profile data. Rules tests cover anonymous users, owners, other students,
verified staff, forged roles, other schools and all new server-only collections.
No new allow rules or deployed indexes are needed for the new backend collections.

## Credentials

Firebase Admin and Gemini modules are server-only. Admin project IDs must match
the configured client project; incomplete service-account pairs fail closed.
Implicit emulator-host environment overrides are rejected outside explicit local
demo mode, and demo mode is rejected in production. Credentials use ignored local
environment files or hosting secrets; no private values are returned by the new APIs.
`pnpm check:secrets` scans tracked files for private configuration, embedded key
material and public-prefixed private keys. This is a guardrail, not a substitute
for provider secret scanning. Rotate exposed keys in the provider console, update
hosting secrets and redeploy; remove exposed material from repository history.
Restrict service-account IAM to required Auth/Firestore operations. Public Firebase
web configuration is expected in browser bundles; its protection is the rules and
authenticated server authorization, not secrecy of the public web API key.

## Duplicate prevention

An account-scoped UUID receipt binds the entire normalized submission input to its
original verdict and attempt. Replay returns that verdict; conflicting reuse is
409. Canonical part completion also prevents a second request ID from completing
the same part. Receipt, history, summaries and credit commit together, so failed
transactions can safely retry. Transaction callback retries, simultaneous answers,
simultaneous skips, prompt replay after clarification, legacy receipts and separate
intentional practice sessions have explicit regression coverage. Retain submission
receipts at least as long as their canonical session; maintenance deletes whole
expired sessions and their attempts/receipts together to preserve this guarantee.

## Privacy, exports and retention

Settings explains private answers/decks, staff statistics, sharing and the exact
original-source data sent for explicit AI generation. `GET /api/account/data`
downloads the authenticated user's Firebase account details, complete nested user
records, own staff/membership records, own assignment progress and own RSVPs,
including surviving personal records from former schools. It never exports other
students' records or accepts a caller-selected UID/path. Exports cap at 5,000 records
and 16 MiB; larger exports require an operator-assisted export from Firebase.
The downloaded JSON preserves Firestore's serialized timestamp representation.

Both download and deletion requests require authentication within five minutes.
The settings form reauthenticates with the current password and clears it after
success. `POST /api/account/data` accepts only `{ "action": "request-deletion" }`
and idempotently queues `privacyJobs/{authenticatedUid}`. An inline confirmation
states that the operator must process the request and that data is retained until
processing completes. This request never erases data immediately or emails anyone.

The trusted maintenance command previews changes by default. The operator selects
the project and a school-approved retention duration (30–3,650 days); no destructive
retention duration is silently selected. For example, to preview a **365-day** policy
and pending deletion jobs, substitute the intended Firebase project ID:

```powershell
node --env-file=.env.local scripts/data-maintenance.mjs --project YOUR_PROJECT_ID --retention-days 365 --deletions
```

Review the counts, then add `--apply` to perform those operations. Local demo
testing requires `--project demo-quizbowl --emulator`. The command rejects accidental
emulator use against a live project and mismatched server project configuration.
It logs counts and phases without credentials, user IDs, answers or names.

Retention removes inactive sessions older than the selected cutoff, their canonical
questions, attempts and submission receipts, and old daily summaries/question markers
and study reviews. It transactionally rechecks activity and closes the canonical
session first, so concurrent attempts cannot resurrect it. Prompts update session
activity too. Interrupted cleanup is recoverable on the next run. Active/recent
sessions, saved decks, assignment credit, profiles and school content are retained.
Dashboards based on history then reflect the retained history window. Expired API
buckets and 32-day AI quota records are removed even when no history duration is set.
Shared clue-cache entries contain only source-derived content and are retained for
reuse. No Firestore TTL deployment or new index is required by this command.

Deletion processing first disables Firebase Auth and revokes refresh tokens, marks
the job deleting, and waits **65 minutes** for existing direct Firestore ID tokens
and in-flight requests to expire. A later maintenance run erases the user's entire
nested tree, staff and legacy memberships, school memberships, share pointers,
assignment progress/receipts and recipient IDs, RSVPs, and source-owner references
in shared-study review receipts. It removes the UID from school author metadata,
deletes the Auth account, and removes the job. It checks the account remains disabled
before erasing; failed runs can resume. School-owned authored content, independent
copies in other accounts, downloaded exports and provider backups are outside this
erasure path. Operators must review free-text mentions and apply their own backup
retention policies.

Run maintenance on the operator's chosen schedule and monitor its exit status;
this task does not install a scheduler or run cleanup against production. Without
an operator run, history is retained and deletion requests remain queued. To process
only quota expiry, omit `--retention-days` and `--deletions`.

Validation: `pnpm test:backend`, `pnpm test:backend:emulator`, `pnpm test:practice`,
`pnpm test:rules`, and the desktop/mobile `tests/e2e/backend.spec.ts`. Set
`E2E_FIREBASE=true` and `E2E_WEBPACK=true` for emulator browser tests using webpack;
set `E2E_BROWSER_PATH` if using an installed Chrome instead of Playwright Chromium.
