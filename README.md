# QuizBowl team workspace

Sections 1 and 2 of `QuizBowl-model-effort-checklist.md` are implemented:
Next.js, TypeScript, Tailwind/shadcn, Firebase accounts, private profiles,
student registration, staff login, role permissions, automatic school membership,
password recovery and changes, email verification, and account preferences.
Practice, student statistics, and question history are implemented as described
below. All of Task 6 deck management, including private and team-shared decks,
is implemented. Assignments and calendar authoring remain later
checklist phases.

## Run locally

Use Node.js 22+ and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. Scripts explicitly invoke Node because the bundled
package-manager fallback can otherwise run Next.js under a different runtime
and fail to spawn its production CSS compiler on Windows.

On this machine, pnpm is available at
`C:\Users\Parthiv\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd`.
Invoke it with `&` in PowerShell. Firebase project `quizbowl-66145` and its
public web configuration are connected in the ignored `.env.local`.

## Accounts and permissions

- **Student:** create an email/password account, edit a private display name,
  grade, and bio, change a password, and save appearance/motion preferences.
  Signing in automatically joins the school configured for this site; no join code or invitation is needed.
- **Teacher:** sign in with an account assigned by a trusted project administrator.
  Verified teachers can access the staff workspace and same-team membership data.
  Staff permissions are limited to their assigned school.
- **Administrator:** create an account through **Teacher / Admin → Create an
  admin account**, entering the private administrator code. The server checks
  the code before creating an account or writing its role. Verify the account's
  email before using team tools.
Each school uses its own deployment with a unique server-only `SITE_TEAM_ID` and
a public `NEXT_PUBLIC_TEAM_NAME`. This site uses `quizbowl-team`. The server
verifies the signed-in Firebase token and enrolls the account in that configured
team, ignoring client-supplied team IDs or roles. Membership is immediate,
including before email verification; staff tools still require verification.
A shared account can join separate school deployments without moving its
existing memberships. Old invitation URLs redirect to sign-in.

Email verification and password-reset emails use Firebase Authentication.
Preferences include light, dark, or system appearance and reduced motion.
Shared components and color tokens apply those preferences across all pages.

### Private admin configuration

`.env.example` describes the required server-only variables:

```dotenv
ADMIN_SIGNUP_CODE=YOUR_STRONG_PRIVATE_CODE
SITE_TEAM_ID=quizbowl-team
NEXT_PUBLIC_TEAM_NAME=Your high school
FIREBASE_ADMIN_PROJECT_ID=quizbowl-66145
```

The code must contain 16–256 characters. A random 32-character code has been
generated in this machine's ignored `.env.local`. Do not add it to a public
environment variable, browser bundle, Git, screenshot, or shared document.
Changing this variable rotates the code without changing existing accounts;
rebuild/restart the application after rotation.

Local server credentials reuse the existing Firebase CLI credential file via
`GOOGLE_APPLICATION_CREDENTIALS`. `scripts/configure-local-admin.mjs` can
restore the local configuration after a Firebase CLI login. It preserves an
already-configured code and prints no secrets. This helper targets this
repository's existing `quizbowl-66145` project.

For hosting, supply a Firebase service account using
`FIREBASE_ADMIN_CLIENT_EMAIL` and `FIREBASE_ADMIN_PRIVATE_KEY`, or configure
Application Default Credentials. Grant only the Firebase Authentication user
management and Firestore access needed by the server. A local credential-file
path cannot be used on Vercel. Server credentials and the code stay private.

The admin signup route rejects absent/wrong codes, malformed/oversized requests,
cross-origin browser requests, and missing team configuration. It uses a
transaction-protected limit of ten code-authorized signup attempts per hour
per school across server instances. Accounts stay disabled while profile/role creation is
in progress; failed setup is cleaned up. Existing emails are never promoted
by signing up again. Signup is not a substitute for email verification.

### Trusted staff maintenance

The website cannot edit staff assignments directly. Project administrators
can assign an existing account with their IAM-authorized Firebase CLI login:

```sh
node scripts/provision-staff.mjs quizbowl-66145 TEACHER_EMAIL teacher quizbowl-team
```

Admin maintenance additionally requires `STAFF_PROVISION_CODE` to match the
private configured signup code. This script never creates an account, changes
a password, or marks an email verified. Add `--check` to look up the selected
account without changing it. Staff assignments can also be removed by a trusted
project administrator in the Firebase console.

## Firebase data and security

| Collection | Purpose | Browser access |
| --- | --- | --- |
| `users/{uid}` | Private profile and preferences | Owner get/create/update; no listing or deletion |
| `staff/{uid}` | Trusted teacher/admin role and team | Owner get; all browser writes denied |
| `teams/{teamId}` | School display name | Enrolled account or matching verified staff get |
| `teams/{teamId}/members/{uid}` | School membership and roster name | Owner get; matching verified staff get/list; owner can sync name from their profile |
| `memberships/{uid}` | Legacy membership retained for migration | Owner get; all browser writes denied |
| `adminSignupLimits/{teamId}` | School signup quota | All browser access denied |
| `users/{uid}/decks/{id}` and its `questions` subcollection | Personal decks saved from history | Server API only; all direct browser access denied |
| `users/{uid}/attemptSubmissions/{requestId}` | Submission binding and original verdict for retry safety | All browser reads and writes denied; server-only |

Profiles created during section 1 are upgraded without deleting names or
creation timestamps. Rules reject unknown fields, role escalation, invalid
preferences, forged timestamps, cross-team roster access, and unauthorized
membership edits. Only the server can create memberships. Roster names sync
when profiles are saved; private bios, grades, emails and preferences stay private. Everything outside these collections is denied by default.
Client route guards improve navigation; Firestore rules enforce authorization.

Deploy checked-in rules with:

```sh
node scripts/firebase.mjs deploy --only firestore:rules,firestore:indexes --project quizbowl-66145
```

Email/Password sign-in must be enabled. Add the website's domain to Firebase
Authentication's authorized domains. Browser Firebase configuration is public;
Authentication and deployed rules protect the database.

## Emulator development and verification

For manual demo development, copy `.env.example` and use:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=demo-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-quizbowl.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-quizbowl
NEXT_PUBLIC_FIREBASE_APP_ID=demo-app
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
FIREBASE_ADMIN_PROJECT_ID=demo-quizbowl
ADMIN_SIGNUP_CODE=YOUR_STRONG_LOCAL_DEMO_CODE
SITE_TEAM_ID=demo-team
NEXT_PUBLIC_TEAM_NAME=Demo High School
```

Run `pnpm emulators` and `pnpm dev` in separate terminals. Emulators require
Java 21+. The Firebase wrapper uses the ignored portable JDK in `.tools/java`
when available. Emulator data is temporary. Emulator mode is rejected in
production; the server also requires a demo project for emulator mode.

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm test:rules
pnpm test:e2e
```

The browser suite starts its own isolated server on port **3100** with
`.next-e2e` output, leaving a development server on port 3000 available.
It explicitly overrides private admin settings to test-only values and never
uses production Firebase for its account flows.

PowerShell, full Firebase browser suite:

```powershell
$env:E2E_FIREBASE = 'true'
node scripts/firebase.mjs emulators:exec --project demo-quizbowl --only auth,firestore 'pnpm test:e2e'
Remove-Item Env:E2E_FIREBASE
```

Install Chromium with `pnpm exec playwright install chromium`, or set
`E2E_BROWSER_PATH` to an installed Chrome executable. Mobile tests use a
Chromium mobile viewport. The tests cover account/session persistence,
profile and preference saves, password changes and recovery, student/staff
permissions, code-protected admin creation, email verification, automatic
school enrollment, repeat enrollment, disabled sessions, and responsive layouts.
Fourteen independent Firestore tests cover profile privacy, schema validation,
role escalation, school isolation, roster name updates, and private attempt history.
GitHub Actions runs the checks.

Stop an existing emulator before running tests that start their own.
Generated build output, credentials, `.env.local`, local tools, and test
screenshots are excluded from Git.

## Deployment status

The updated Firestore rules and indexes are deployed to `quizbowl-66145`.
The owner-only practice attempt read rules were deployed on 2026-10-10 after
emulator validation. Attempt writes and canonical session data remain server-only.
The first administrator, `bhonagirip23@gmail.com`, was created through the
code-protected server endpoint after authorization. Live sign-in, owner
profile/role access, and denial of server-only quota data passed verification.
Automatic school enrollment for the existing admin and cross-school roster
isolation have also been verified against the deployed rules.

The generated temporary password is saved privately in the ignored
`.tools/admin-access.txt`; the signup code is in `.env.local`. Sign in, use
**Send verification email**, confirm the link in your inbox, and use **Refresh
verification** to enable staff tools. Change the temporary password in
**Account settings**. Email verification remains an action for the account owner.

`scripts/create-initial-admin.mjs` is the local provisioning/verification helper.
The production preview can be started with `pnpm start -- --port 3101` after a
build. The Vercel website itself has not been deployed.

The GitHub repository is [Pbhon/Quizbowl_Website](https://github.com/Pbhon/Quizbowl_Website).
The GitHub-to-Vercel import is still pending from section 1. When importing,
use the repository root, `pnpm install --frozen-lockfile`, and `pnpm build`.
Configure the public Firebase web variables and private admin server variables
in the appropriate Vercel environments, with emulator mode false. Add the final
website domain to Firebase Authentication.

Gemini remains reserved for later features; no AI generation occurs here.

References: [Firebase user management](https://firebase.google.com/docs/auth/web/manage-users),
[atomic Firestore transactions and rules](https://firebase.google.com/docs/firestore/manage-data/transactions),
[Firebase Admin setup](https://firebase.google.com/docs/admin/setup).

## QBReader practice (Task 3)

`/practice` now supports real tossups and bonuses, difficulty 0–10, category and
subcategory filters, topic searches across question text and answer lines, and
sessions of 1–50 questions. Tossups reveal word by word with pause, reading speed,
and buzzing controls. Typed answers use QBReader's official checker, including
accept, reject, and directed prompts. Bonuses retain every valid part and reveal
each official answer line with its accepted alternatives after answering or skipping.

Session summaries count correct, incorrect, and skipped responses, with each bonus
part counted separately. Accuracy excludes skips. Previously answered question IDs
are stored per account (or guest) in this browser, capped at the latest 10,000 IDs.
Answering any part of a bonus marks that bonus as answered; skipping alone does not.
The exclusion option uses these IDs and deduplicates questions within each session.
The local exclusion list does not sync across browsers or devices. Signed-in
responses are saved in Firestore under `users/{uid}/attempts`, including correct,
incorrect, skipped, and clarification responses. Each record retains the original
question, official answer lines, submitted answers, verdicts, and server timestamps.
Guest practice remains temporary.

Authenticated question fetching creates a server-managed canonical session under
`users/{uid}/practiceSessions`. The attempt endpoint verifies the Firebase ID token,
checks answers against that session's original answer line, and uses a transaction
to save each part and update session totals. Stable submission IDs make retries
idempotent, including when a save succeeds but its acknowledgement is lost. The
reader waits for saving before showing a verdict or advancing. On a transient
failure, the submitted answer stays fixed until the same submission is retried.
Clarifications are saved before requesting the next response. Students can read
only their own attempt history; all writes and canonical session access are
server-managed. This schema supports the later dashboard and history features.

Question requests use QBReader's random endpoints or its query endpoint for topics.
Requests are bounded to five batches, with a notice if fewer matching unseen
questions are available. API failures preserve typed answers for retry. No AI calls
are made by practice.

Run `pnpm test:practice` for server logic checks and `pnpm test:e2e` for desktop and
mobile practice flows. Set `QBREADER_LIVE=true` to include the opt-in live API route
smoke test. This machine required `next build --webpack` and `next dev --webpack`
for verification because Turbopack failed to start its CSS subprocess; the standard
project scripts remain unchanged.

The persistence browser tests require `E2E_FIREBASE=true` with the Authentication
and Firestore emulators. They use live QBReader answer checking to verify accepted,
rejected, prompted, and skipped responses, lost acknowledgements, concurrent
retries, immutable session questions, and isolation between accounts. Firestore
rules tests verify owner-only reads and denial of forged client writes.

API references: [random tossups](https://www.qbreader.org/tools/api-docs/random-tossup),
[random bonuses](https://www.qbreader.org/tools/api-docs/random-bonus),
[topic query](https://www.qbreader.org/tools/api-docs/query), and
[answer checking](https://www.qbreader.org/tools/api-docs/check-answer).

## Student dashboard (task 4)

Open `/dashboard` or **My dashboard** after signing in. The dashboard includes
question and response totals, correct/incorrect/skipped responses, accuracy by
category, subcategory and difficulty, daily/weekly/monthly activity, interactive
progress charts, the eight latest sessions, upcoming work and competitions, and
links to practice weak subjects. Recommendations require at least three answered
responses and accuracy below 70% in a subcategory.

Each question counts once per session; bonus parts count separately as responses.
Accuracy is correct / (correct + incorrect). Skips and pending clarifications do
not affect accuracy. Activity uses completion timestamps in the browser's timezone,
calendar months, and weeks beginning Monday. Charts include zero-activity periods.
Saved records are aggregated on demand, including existing practice history; this
currently reads the student's full attempt collection on each dashboard refresh.

`GET /api/dashboard` verifies a non-revoked Firebase token and derives the UID
exclusively from that token. It reads only `users/{uid}/attempts` and
`users/{uid}/practiceSessions`. Responses cannot be cached, and account changes
discard dashboard state and cancel pending requests. No client UID can select
another student's statistics. Existing Firestore rules keep client writes to these
records denied; the dashboard needs no rule deployment.

Upcoming records are read only after checking the student's membership in the
configured school. The read contract for later assignment/calendar features is:

- `teams/{teamId}/assignments/{id}`: `title`, `dueAt` (Firestore timestamp or ISO
  timestamp), `published: true`, and either `audience: "team"` or `studentUids`.
- `teams/{teamId}/events/{id}`: the same audience/publication fields plus
  `type: "competition"` and `startsAt` instead of `dueAt`.
- Cancelled, completed, past, unpublished, and other-student records are excluded.
  Missing records show an empty state. Creating assignments and calendar events
  remains in tasks 10 and 11; dashboard data is server-managed.

Run `pnpm test:statistics` for aggregation, timezone, audience and isolation tests.
`tests/e2e/dashboard.spec.ts` checks signed-out access and, with Firebase emulators,
desktop/mobile charts, recommendation filters, retry and switching accounts.

## Question history (task 5)

Open **Question history** or `/history` after signing in. The page shows the 30
most recent question-part attempts by creation time, with **Older attempts** to
browse the complete history. Filters apply across all history and include subject,
subcategory, difficulty 0–10, correct/incorrect, skipped, and awaiting clarification.
Attempts show submitted responses, official answer lines, the complete original
question, source information, and all clarification submissions. Task 3 already
persists this full history in Firestore; guest sessions remain temporary.

**Retry missed question** opens the original saved question in `/practice`.
Starting the retry creates a new canonical session and retains the previous
attempt. For bonuses, retry includes every original part. Normal answer checking
and saving still apply. Use **Practice new questions instead** to exit retry mode.

**Add to deck** saves the full original question to an existing personal deck or
creates a named deck. `/decks` displays these decks and their questions, bonus
parts, and original answer lines. Saving makes no AI calls. Task 6 extends this
with deck management, sharing, and flashcard study as described below.

`GET /api/history`, `GET /api/decks`, and `POST /api/decks` authenticate a
non-revoked Firebase token and derive ownership exclusively from its UID.
Cursor, retry, and save identifiers are resolved under that account. Deck writes
use the saved attempt's original question; clients cannot supply question content.
Responses are private and uncached. Browser account changes clear loaded history
and decks and cancel pending reads. These APIs use server access and require no
new Firestore rules or composite indexes. History scans batches of 100 records
until it finds 31 matching attempts or reaches the end; narrow filters over large
histories can therefore read many records.

Duplicate history prevention is complete. Each response ID is bound to its session,
question index, bonus part, submitted answer, skip flag, and reading position under
the authenticated account. Its private receipt is committed in the same Firestore
transaction as the history record and session totals. Repeated requests return the
original verdict without rechecking, appending submissions, changing timestamps,
or increasing scores. Reusing an ID for different content, parts, or sessions returns
409. UUID casing and surrounding answer whitespace normalize before comparison.
Completed parts cannot be submitted again with a fresh ID. Clarifications remain
in one history row; separate parts and deliberate new practice sessions still count.

Existing attempts remain readable and receive receipts when their original
submissions are replayed, without changing their saved history or totals. Receipt
binding applies to new submissions and these replayed legacy submissions; no bulk
migration is required. Existing deny-by-default rules protect receipts, so no rule
deployment or new composite indexes are needed.

Run `pnpm test:history` for filter, pagination, owner-scoped lookup, retry, and
full-question saving checks. `tests/e2e/history.spec.ts` tests authenticated history,
filters, pagination, new/existing deck saves, saved bonus retries, and account
switching on desktop and mobile with the Firebase emulators.
`pnpm test:practice` covers concurrent answers, transaction callback retries,
prompt replays, conflicting IDs, and legacy compatibility.
`tests/e2e/practice-persistence.spec.ts` additionally checks real concurrent
Firestore submissions, lost acknowledgements, history after reload, and account
isolation. Rules tests verify receipt privacy.

## Custom study decks (Task 6)

At `/decks`, create an empty deck or populate it with 1–50 original QBReader
tossups or bonuses matching a topic. Topic import uses the existing server
question-fetching pipeline and saves from its canonical session; it does not
record answers or affect practice scores. A narrow topic may return fewer
questions than requested. No AI is called.

Every account receives a default **Starred Questions** deck when loading decks
or starring a practice question. The practice reader can star a question before
answering. Practice questions, history questions, and existing saved cards can
be added to up to eight decks at once. New saves use stable per-question card IDs
and transactions, so repeated starring/saving does not overwrite study edits
or duplicate new cards. Existing decks and cards remain readable.

Decks support names, descriptions, and up to twenty custom topic tags. Saved
cards support editable question text, study answer lines, topic tags, and notes.
The full original QBReader question, every bonus part, source, and official
answer lines remain separately available. Copying a card to another deck saves
its original question. Study edits do not change practice answer checking.
Search covers question text, answers, subjects, sources, notes, card tags, deck
names, and deck tags. Flashcards show the full question on the front and all
answer lines on the back, with previous/next navigation.

Deck and card removal require confirmation. The default Starred Questions deck
keeps its name and cannot be deleted; its cards can be removed. All API actions
authenticate Firebase tokens and derive ownership from the signed-in account.
Client-supplied owner IDs are ignored. Decks retain the existing server-only
Firestore access; no rule deployment or composite index changes are required.

Decks are private by default, including legacy decks without a visibility field.
Choose **Team-shared** when creating or editing a deck to share its full cards,
study edits, tags, and notes with the configured school's current members.
Only the owner can add, edit, remove, rename, delete, or change visibility;
teammates can browse, search, study, and copy original cards to their own decks.
The destination picker only offers decks the signed-in user owns. Starred
Questions always stays private; copy its cards to another deck to share them.

Team discovery uses server-only pointers at
`teams/{teamId}/sharedDecks/{hashOfOwnerAndDeck}` to the owner's canonical deck.
The school comes from server configuration, never client-supplied team IDs.
Sharing requires membership in that school. Existing sharing with another
school is preserved during ordinary owner edits; make a deck private and share
again to choose the current deployment's school. Membership, the pointer,
current deck visibility, and cards are read in one transaction for shared
reads/copies. Private visibility and deletion remove the sharing pointer in the
same transaction as the deck change. Stale or mismatched pointers grant no
access. Revoking sharing or membership blocks subsequent server reads and
copies; content already read or copied cannot be recalled. Use **Refresh decks**
to refresh the displayed team library after an owner changes sharing.

`tests/e2e/deck-sharing.spec.ts` verifies private defaults, owner and teammate
UI permissions, school isolation, forged owner/team IDs, shared card copying,
visibility and membership revocation, stale pointers, concurrent copy/revocation,
and shared-deck deletion on desktop and mobile. The Firestore rules suite also
verifies that private decks, shared content, and directory pointers cannot be
read, forged, or deleted directly by browser accounts, including staff.

`tests/e2e/decks.spec.ts` verifies topic import, direct starring, repeated saves,
multiple destinations, deck/card edits, original bonus preservation, tags,
search, flashcards, deletion, input validation, and account ownership on desktop
and mobile using local Firebase emulators. Topic responses are supplied from
canonical emulator fixtures, so these checks do not depend on live QBReader.
The existing practice tests cover the QBReader fetching contract.

On this machine the default Turbopack production build can fail while launching
its CSS compiler. The documented Next.js fallback is
`node node_modules/next/dist/bin/next build --webpack`, which passes.

## Anki exports (Task 8)

Open **Export to Anki** on any accessible deck at `/decks`, including
team-shared decks. Choose full questions or saved AI identifiers, filter by
category and difficulty (0–10), and optionally filter identifiers by complexity.
The matching card count controls the APKG and CSV download buttons.
Deck-browser search does not affect exports. Full bonuses include their lead-in
and every part; full tossups export as one card. Study question edits are exported,
while answers always come from the saved original QBReader question.

APKG downloads contain a schema-11 SQLite collection and empty media manifest
inside a ZIP. Open the package in Anki to install the **QuizBowl v1** note type
with ID, Front, and Back fields and one question/answer card template. The ID
field is hidden on the card. Packages contain new cards without review history.
Choose **Always update notes** to refresh existing notes, leave learning-progress
import disabled to preserve your reviews, and retain the shipped field/template
schema. Anki's package timestamps have whole-second precision, even with Always
update selected; if an edit exported in the same second does not refresh a note,
download it again a second later. See the
[official package import guide](https://docs.ankiweb.net/manual/importing/packaged-decks).

CSV uses UTF-8 and quoted ID, Front, Back, Tags, and GUID columns. File headers
select comma separation, HTML, the note type, and the special Tags/GUID columns.
Import an APKG once to install QuizBowl v1, then use that same note type for CSV.
Map ID/Front/Back to their fields and Tags/GUID to their special import columns.
Keep ID and GUID unchanged to allow updates across CSV and APKG imports.
Pre-feature CSVs imported into Basic lack these identities and cannot be merged
automatically with the new exports. Instructions are included in the deck panel;
see the [official text import guide](https://docs.ankiweb.net/manual/importing/text-files).
Category, subcategory, difficulty, deck/card topics, and identifier complexity
become tags. Tag values are percent-encoded to preserve spaces within one tag.
Answers include subject metadata and tournament/packet attribution when saved.
Basic HTML emphasis and line breaks are retained; other markup is escaped and
HTML attributes are removed. Older saved questions use their stored plain text;
new QBReader questions also retain formatted parts and lead-ins.

Task 7 generation is still pending. Export only reads saved card `identifiers`
arrays containing `{ id?, clue, complexity, part, sourceExcerpt }`; complexity is
`simple`, `intermediate`, or `complex`, and `part` is a zero-based original answer
index. Malformed identifiers are omitted. Each exported identifier includes
its original official answer and verification excerpt. Export never calls AI.
No generation UI or generation/cache/quota implementation is introduced here.

Note IDs use SHA-256 over versioned original-question identities, with a saved
identifier ID and part for clue cards. Legacy identifiers without IDs use their
original source excerpt and part; clues with the same legacy source identity
collapse into one note. Editing clue text or complexity keeps its identity.
Account/deck IDs, names, filters, and editable question text do not affect note
identity. Duplicate source notes within an export merge their tags. APKG and CSV
use the same GUIDs. Canonical deck paths are hashed for APKG deck IDs; raw account
IDs are not included in downloaded files.

The authenticated `/api/decks/export` endpoint rechecks ownership or live school
membership/sharing and reads cards in the same Firestore transaction. It accepts
only deck references and filters, not caller-supplied question data. APKG exports
are limited to 5000 saved questions, 5000 notes, and 16 MiB of serialized note data.
The server uses unique temporary files, closes SQLite, and cleans up afterward.
Node **22.13+** is required for built-in SQLite; Node 24 was verified here.

All task 8 subtasks are complete. Run `pnpm test:anki` for CSV/identity/archive
checks. Desktop/mobile deck tests cover both downloads, stored identifiers,
empty/invalid filters, private access, shared access, and revoked access.
`pnpm test:anki:imports` uses the official Anki 26.9.3 backend to import APKG/CSV,
render cards, reimport duplicates, update edits, import filtered copies, switch
between formats, and verify review scheduling is preserved. It uses temporary
collections under `.tools` and never opens the user's Anki collection.

To run backend validation, create a Python virtual environment, install
`tests/anki-requirements.txt`, and set `ANKI_TEST_PYTHON` to its Python executable:

```powershell
python -m venv .tools/anki-venv
.tools/anki-venv/Scripts/python.exe -m pip install -r tests/anki-requirements.txt
$env:ANKI_TEST_PYTHON = (Resolve-Path .tools/anki-venv/Scripts/python.exe).Path
pnpm test:anki:imports
```

## Teacher/Admin dashboard (task 9)

Verified teachers and administrators can open `/team` to see the configured
school's full roster, select an individual student or the whole student team,
compare subject/subcategory/difficulty accuracy, inspect daily/weekly/monthly
activity and charts, view subject-by-difficulty heatmaps, identify weak areas,
and filter student participation. Staff accounts appear in the roster but are
excluded from student aggregates. Question totals deduplicate bonus parts within
each student's session; accuracy uses correct / (correct + incorrect) responses.
All dates use the viewing staff member's browser timezone, and weeks start Monday.

`GET /api/team/dashboard` validates the authenticated user, current email
verification, staff role, and configured school. Client-provided school IDs cannot
select another school. Student data comes only from current school members, and
staff access and roster membership are rechecked before returning data. Responses
and exports are private and uncached. Use `format=csv` for a team export and
`student=<uid>` for an individual export. CSV includes subject, difficulty,
heatmap, time-period, participation, deck/review, and assignment rows; text fields
are quoted and protected against spreadsheet formulas.

The assignment viewer reads published `teams/{teamId}/assignments/{id}` records
with `audience: "team"` or a `studentUids` recipient list, `questionCount`, and
optional `dueAt`. Expanded group recipients can use `studentUids`. It reads trusted
`progress/{uid}.completedQuestions` documents beneath each assignment. Missing
progress shows not started (or overdue after its deadline), and completed counts
are clamped to the target. Assignment creation and automatic progress updates
remain task 10; ordinary practice is not credited without a progress record.

Deck activity reports current owned deck/card inventory and the latest surviving
deck's update timestamp; it does not expose private card text. In-site answer
reveals now save authenticated, server-timestamped `users/{uid}/studyReviews/{uuid}`
receipts through `POST /api/decks/reviews`. Repeated flips for the same card visit
and retries reuse one receipt. A later visit is another review. Card access and
shared visibility are checked transactionally. Failed saves show a retry control.
Review counts start with this feature; Anki review synchronization remains task 14.
Deck deletions are reflected in inventory, not retained as a change history.

Run `pnpm test:team` for calculation, permission, receipt, and CSV tests. Firebase
emulator browser coverage is in `tests/e2e/team-dashboard.spec.ts` for desktop and
mobile, including role revocation, school isolation, flashcard review recording,
assignment progress, charts, exports, failure recovery, and account switching.

### Task 10: assignments and teacher curation (non-High subtasks)

Verified school teachers/admins create, edit, draft, and publish assignments at
`/assignments`. Students see only published assignments addressed to them, with
instructions, question type/count, difficulty range 0–10, category/subcategory,
optional topic requirement, and optional deadline. Select one student, a group of
up to 200 current students, or the entire team. Selected groups are saved as a
snapshot of student IDs; team assignments apply to current team members. Deadlines
are stored as UTC ISO instants and entered/displayed in the browser's local timezone.
Question counts support 1–500 questions and are requirements, not a single session
size. The existing QBReader reader continues to support up to 50 per session.

Completion/performance reads `teams/{teamId}/assignments/{id}/progress/{uid}`.
`completedQuestions` is a whole-question count (bonus parts count as one question).
Optional nonnegative integer `correct`, `incorrect`, and `skipped` fields count
responses. Accuracy is correct / (correct + incorrect), excluding skips. Absent
or malformed performance fields display as unknown; missing progress is not
started. This release does not write progress or credit ordinary practice. The
High automatic tracking subtask is still deferred. The team dashboard's existing
assignment completion viewer continues to read the same records.

Teachers curate private decks at `/teacher-decks`, using existing topic question
retrieval, saved questions, tags, card notes, and editing. Creation records the
verified staff creator in `curatedBy`. Adding saved questions from practice/history
works through the usual deck picker. High teacher-sharing and teacher-specific
edit-policy work remains deferred; existing Task 6 school-sharing/owner permissions
remain in place. Students can study and export already-shared decks at `/decks`,
or choose **Practice shared deck** to start a saved reader session using the first
1–50 original questions. This source uses deck questions, so QBReader filters do
not alter it. Starting practice and APKG export check live membership and sharing;
revocation blocks new sessions/downloads. Already-started sessions retain their
saved question snapshot. CSV exports use cards already loaded into the browser.

Validation: assignment unit tests cover staff authorization, targeting, requirements,
deadlines, saved result counting, student visibility, and teacher provenance.
Firebase-emulator browser tests cover assignment editing, student isolation,
teacher curation, shared-deck practice, APKG/CSV downloads, desktop/mobile layout,
and sharing revocation. Run `node --test tests/assignments.test.mjs` for unit tests;
run `tests/e2e/assignments.spec.ts` with the existing Firebase emulator setup for
browser tests. No Firebase rules deployment is needed: assignment access uses the
existing server authentication and staff/membership checks; direct client writes
remain denied.
