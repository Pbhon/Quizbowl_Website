# Team deployment readiness

Audit date: 2026-10-18. The repository is prepared for deployment; the production
hosting setup and the owner's email verification still need completion.

## Required launch steps

1. Import `Pbhon/Quizbowl_Website` into the intended Vercel project. Use the repository
   root, Node.js **24.x**, `pnpm install --frozen-lockfile`, and `pnpm build`.
   The build uses webpack, matching the verified local production build.
2. Configure hosting environment variables from `.env.example`. The public Firebase
   variables and `FIREBASE_ADMIN_PROJECT_ID` must select the same live project.
   Supply a Firebase service-account email and PEM private key through private
   hosting variables. The local `GOOGLE_APPLICATION_CREDENTIALS` path is only for
   this computer and must not be copied to Vercel. Set the team ID/name and private
   administrator registration code; keep emulator mode off.
   Set `GEMINI_STUDENT_DAILY_LIMIT=20` and
   `GEMINI_DEPLOYMENT_DAILY_LIMIT=400` (team-wide). Redeploy after changing Vercel
   variables; an older explicit value of 200 overrides the new default.
3. Add the final hostname to Firebase Authentication's authorized domains.
   The live project currently authorizes Firebase's default hosts, localhost and
   127.0.0.1. No Vercel/custom production hostname was present during the audit.
4. The existing owner administrator must verify their email using **Profile → Send
   verification email**, complete the emailed link, then refresh verification.
   Its administrator role and school membership are correct; its email was still
   unverified during the audit. Staff pages intentionally remain locked until then.
5. Run a smoke check on the deployed URL: sign in, open the team dashboard, save a
   question, generate/reuse clues, export a deck and check a student account's
   assignment/calendar access. Review Vercel request/function logs for 5xx errors.

`pnpm check:deployment` validates the environment supplied to that command without
connecting to any services or displaying values. The Vercel build runs this check
automatically and fails on missing service credentials, mismatched/demo projects,
emulator hosts, missing team/admin configuration or incomplete enabled AI settings.
To check an ignored local export of hosting variables:

```powershell
node --env-file=.env.hosting scripts/check-deployment.mjs
```

`node --env-file=.env.local scripts/check-deployment.mjs --local` explicitly permits
local ADC credentials. Passing that local check does not verify the hosted setup.
No hosting project or production URL was linked in this checkout during the audit.

## Accounts and data isolation

Automated test accounts live only in `demo-quizbowl` Auth/Firestore emulators on
localhost. Production rejects emulator mode. There is no hard-coded test login or
authentication bypass in the application. Each endpoint verifies Firebase tokens
and applies its role/owner/school checks.

The two separate manual testing accounts previously created in the live Firebase
project were deleted at the owner's request, together with their profiles, staff
roles, memberships, decks and sharing pointers. Their absence was verified through
Firebase Admin, and their stored testing passwords were removed. They cannot sign
in to a deployment using that live project. The real owner account was retained.

School enrollment remains automatic by the owner's earlier design: anyone who
registers and signs in to this deployment joins its configured school. A private URL
does not enforce a school email restriction. Keep the intended audience in mind
when sharing the registration URL; school-domain or approval-based enrollment would
be a separate product change.

The deployed Firestore rules match this repository's access conditions; the only
source difference found was comments. Existing server-only caches, quotas and deck
writes remain denied to browser SDKs. No rules change was needed for this audit.

## Gemini and operations

Use `GEMINI_MODEL=gemini-3.5-flash-lite` with the private key and explicit enable flag.
The older 2.5 model returned metadata but rejected generation for this new account.
After correcting the REST response-format enum, a real synthetic saved-question
generation produced three source-validated cards. A second request used the cache
and made no additional provider call. All smoke-check Firebase writes used the local
emulator, and no student data was sent to Google.

The owner confirmed the deployment's intended users are all 18 or older. Google's
current [API terms](https://ai.google.dev/gemini-api/terms) exclude clients directed
toward or likely accessed by under-18s. Reassess provider eligibility if the audience
changes. Confirm free-tier/billing status and actual project quota in AI Studio;
set application quotas no higher than the provider allowance. See
[ai-generation.md](ai-generation.md) for exact cache, quota and retry behavior.

Choose and document a maintenance owner, retention/backup policy and monitoring
routine before team rollout. The existing [backend maintenance command](backend.md)
previews retention/deletion work and can remove expired quota buckets without
deleting practice history. No maintenance scheduler, alert subscription or backup
policy is installed by this repository. Vercel's request/function logs can be used
to investigate failures; do not put credentials or student answers into logs.

## Repeatable checks

GitHub Actions checks credential leaks (including current Google authorization
keys), production dependency advisories, deployment configuration, lint, formatting,
types, unit suites, a production build, Firestore rules/transactions, and browser
flows in both unconfigured and demo-emulator environments. Transitive gRPC/UUID
overrides pin the patched releases; the audit found no known production dependency
advisories after those patches.

For local browser tests, set `E2E_WEBPACK=true`, `E2E_FIREBASE=true` and optionally
`E2E_BROWSER_PATH` to an installed Chrome. `QBREADER_LIVE=true` opts into real
QBReader retrieval/answer-check smoke tests. Browser tests explicitly disable live
Gemini generation. Anki APKG/CSV import checks use `pnpm test:anki:imports` with
`ANKI_TEST_PYTHON` pointing to an environment containing the documented Anki backend.
