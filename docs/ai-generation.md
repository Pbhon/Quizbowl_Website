# Identifier generation

Use a Gemini Developer API key from a **free-tier project without billing** in
[Google AI Studio](https://aistudio.google.com/api-keys). Configure the private
server environment (locally `.env.local`, or your hosting provider's secrets):

```dotenv
GEMINI_API_KEY=your-private-key
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_GENERATION_ENABLED=true
```

Restart the server after changes. The example model currently offers free text
input/output; confirm your project's model availability and limits in AI Studio.
The API cannot enforce a billing tier: using a billed project can incur charges.
No fallback model or paid service is selected automatically. Google may use
free-tier content to improve products. Only original QBReader source and official
answers are sent; student answers, identity, edits and notes are excluded.

Provider integration uses REST `generateContent`, header authentication, a bounded
structured JSON response, a 45-second timeout and independent source validation.
Configuration stays server-side. A missing key, model or opt-in blocks new provider
calls. With the same configured model, existing cache entries remain usable while
provider generation is disabled.
Tests mock the provider and never consume the live free tier.

The 2026-10-18 deployment audit additionally verified one live generation from a
synthetic saved question in the local Firestore emulator: three validated cards,
followed by a cache replay with no second provider call. `generateContent` uses
`responseFormat.text.mimeType: "APPLICATION_JSON"` (an enum, not a MIME string).
The older 2.5 Flash-Lite model's metadata was readable but generation was unavailable
to this new account; the configured 3.5 Flash-Lite model passed the real request.

Provider eligibility must be checked before team rollout. The owner confirmed an
18+ intended audience for this deployment. Google's current
[Gemini API terms](https://ai.google.dev/gemini-api/terms) exclude API clients
directed toward or likely accessed by people under 18; an adult account alone does
not make a deployment for minors eligible.

## Student workflow

In practice, history or saved cards, check **Generate AI clues after saving** to
opt in before starring or adding a question to a deck. The question is committed
first, and failure never undoes that save. Each saved question at `/decks` and
`/teacher-decks` also offers **Generate AI clues**. Fresh topic imports can use
that saved-question control. No generation runs automatically on page load,
ordinary fetching, buzzing, answering, answer reveals, review recording or exports.

Generated fronts isolate individual source facts, include their own context and
classify as giveaway/simple, intermediate or early-buzzer/complex. The prompt asks
for all supported levels without inventing levels absent from the source. Each
card retains its original part's complete official answer and an exact excerpt
from that part. Preview, filter and flip the cards; check excerpts against the
original source. Automated validation checks structure, part binding, exact source
excerpts, duplicate fronts and some context-dependent phrasing. It cannot prove
semantic correctness or difficulty: students must review the generated content.

Owners can edit fronts and classifications, or confirm removal of inaccurate
clues. These changes affect only that deck, keep stable clue IDs and never change
the original answers, excerpts or shared cache. Another student's cache hit or a
normal retry cannot restore removed clues or overwrite personal edits.

**Check generation status** is read-only and shows the current allowance.
`pending` means a saved question is waiting for an explicit request, not a queued
background job. `generating` is an active lease; `completed` means a saved/shared
result is ready; `failed` is a provider/validation failure or expired lease.
Refresh/check status after an interruption; **Use cached clues** attaches an
available result. No provider retry loop runs in the browser or server.

**Retry generation** retries an initial failure after its cooldown. **Regenerate
AI clues** requires confirmation because success replaces personal edited/removed
clues in that deck. It sends the saved result revision; if another student has
already replaced that revision, the newer cache is reused. Simultaneous requests
share the lease, and replaying a stale revision never starts another provider
call. Edits made during regeneration cause a conflict instead of being overwritten.
Failed regeneration preserves existing cards and the previous shared result;
use the regeneration control again to explicitly retry replacement after cooldown.

## Cache, quotas and failures

The server checks verified ownership and current teacher permissions, loads only
the original saved source, then checks the server-only Firestore cache before
every generation. Keys bind source content, official answers, model and prompt
version. Cache results are independently validated, shared across students and
contain no student metadata. A private 90-second lease with a fencing token and
transactional quota reservation prevents simultaneous duplicate calls. Provider
work has a 45-second timeout and a 128,000-byte response cap. Expired leases can
be retried; networks and external providers cannot guarantee exactly-once billing.

Default limits: 20 attempts per student per UTC day, 400 per deployment per UTC day,
10 per deployment per minute. Configure private `GEMINI_STUDENT_DAILY_LIMIT` (1–20),
`GEMINI_DEPLOYMENT_DAILY_LIMIT` (1–1,000), and
`GEMINI_DEPLOYMENT_MINUTE_LIMIT` (1–60) to fit the project's actual free-tier quota.
Malformed configuration fails closed. Limits apply to regeneration too; failures
consume quota, cache hits do not. The API proxy also caps generation/status requests
at 10 per minute per authenticated account. Daily application quotas reset at UTC
midnight, which may differ from Google's quota reset. Usage expires through the
existing retention command; nothing installs a background cleanup service.

Errors hide raw provider details. Provider `Retry-After` is bounded to 60–3,600
seconds; other generation failures cool down for one minute. Quota errors return
the next application reset, and active leases return their expiry. Responses carry
`Retry-After` and a safe `retryAt`; the UI shows when a manual retry is available.

## API and validation

`POST /api/ai/clues` accepts `{deckId, cardId}` or the confirmed replacement form
`{deckId, cardId, regenerate: true, expectedRevision}`. Unknown fields and malformed
revision requests are rejected. `GET /api/ai/clues?deckId=...&cardId=...` reads status
and the authenticated owner's allowance only. Both require current verified
ownership/editor access; students copy a shared source to their own deck first.
Responses are private and uncached. Fencing tokens and private configuration are
never returned. Existing Firestore rules deny direct cache, quota and deck writes;
no rule or index deployment is required.

Run `pnpm test:ai`, `pnpm test:backend:emulator`, and `pnpm test:rules`. Desktop/mobile
browser coverage is in `tests/e2e/clues.spec.ts` and `tests/e2e/decks.spec.ts` with
`E2E_FIREBASE=true`, `E2E_WEBPACK=true` and the local Auth/Firestore emulators.
The browser server disables provider calls and exercises real cached delivery,
editing, removal, source reveals, allowance checks and confirmed regeneration.
Provider contracts, malformed results, failures, leases, quotas and regeneration
races use mocked responses; real Firestore contention is tested separately.

Provider references (checked 2026-10-18): [pricing](https://ai.google.dev/gemini-api/docs/pricing),
[project rate limits](https://ai.google.dev/gemini-api/docs/rate-limits),
[generateContent contract](https://ai.google.dev/api/generate-content).
