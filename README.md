# QuizBowl team workspace

Project initialization for section 1 of `QuizBowl-model-effort-checklist.md`.
Next.js App Router, TypeScript, Tailwind CSS, official shadcn/ui components,
Firebase email/password authentication, and private Firestore profiles are implemented.
Practice, decks, and calendar routes are explicit placeholders for later checklist phases.

## Run locally

Use Node.js 22 or newer and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. The layout works without Firebase configuration;
the sign-in page explains the missing configuration and disables its form.
On this machine, the bundled pnpm command is:
`C:\Users\Parthiv\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd`.
In PowerShell invoke that quoted path with `&` and append `dev` or another command.

## Firebase local development

Copy `.env.example` to `.env.local`, then use these demo values:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=demo-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-quizbowl.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-quizbowl
NEXT_PUBLIC_FIREBASE_APP_ID=demo-app
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
```

Run `pnpm emulators` in one terminal and `pnpm dev` in another.
The emulator UI is http://127.0.0.1:4000. Use fictional accounts for local tests.
The CLI requires Java 21+. `scripts/firebase.mjs` automatically uses the optional
portable JDK in `.tools/java` on this Windows machine; that directory is ignored
by Git. Other machines and CI should install Java 21 themselves.
Emulator data is temporary and disappears when the emulators stop.

## Connect a real Firebase project

1. Select or create the intended Firebase project and register a web app.
2. In Authentication, enable Email/Password sign-in. Add the deployed domain
   to Authentication's authorized domains, and add localhost for development.
3. Create the default Cloud Firestore database in the chosen region using production mode.
4. Copy the web app configuration into `.env.local`. Fill the public Firebase
   values from `.env.example`; set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false`.
5. Sign in with `pnpm exec firebase login`, then deploy the checked-in rules and indexes:

```sh
pnpm exec firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
```

Registration creates `/users/{uid}` with a display name and server timestamps.
Only the account owner can get or update that profile. Listing, deletion,
client-assigned roles, and all other collections are denied. Teacher/admin roles,
invitations, attempts, and other data models belong to later checklist phases.
Firestore authorization must be deployed before real users use the app.

## Environment and secrets

`.env.local`, `.vercel`, and local credentials are excluded from Git.
Firebase's browser configuration is public; security comes from Authentication
and Firestore rules. Never place admin credentials or a Gemini key in a
`NEXT_PUBLIC_` variable. `GEMINI_API_KEY` is reserved for the later server-side
AI integration; no Gemini requests occur in this initialization.
The starter does not need Firebase Admin SDK credentials.
Next.js embeds public variables at build time, so rebuild after changing them.
The app rejects emulator mode in production.

## Connect GitHub to Vercel

The private GitHub repository is [Pbhon/Quizbowl_Website](https://github.com/Pbhon/Quizbowl_Website),
connected locally as `origin`. Firebase project `quizbowl-66145` is connected.
The Vercel destination and repository import are still pending.

1. Use the existing `Pbhon/Quizbowl_Website` repository on GitHub.
2. In Vercel, select **Add New → Project**, choose the intended team, and import
   that repository through the Vercel GitHub integration.
3. Use the detected Next.js framework, repository root, `pnpm install --frozen-lockfile`,
   and `pnpm build`. Vercel detects the lockfile and package manager.
4. Add the real `NEXT_PUBLIC_FIREBASE_*` configuration to the appropriate
   Vercel environments. Keep emulator mode false. Do not add an AI key until needed.
5. Deploy, add the resulting domain to Firebase Authentication authorized domains,
   and verify registration, profile persistence, sign-in, and sign-out on that domain.

Importing the repository configures Vercel's Git integration for future deployments.
This live connection remains pending until the target projects are identified.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test:rules
pnpm exec playwright install chromium
pnpm test:e2e
```

Stop an existing Firestore emulator before `pnpm test:rules`, which starts its own.
To test the Firebase browser flows, run `pnpm emulators`, then run browser tests
with `E2E_FIREBASE=true`. PowerShell:

```powershell
$env:E2E_FIREBASE = 'true'
pnpm test:e2e
Remove-Item Env:E2E_FIREBASE
```

Set `E2E_BROWSER_PATH` to an installed Chrome executable to use it instead of
downloading Chromium. The mobile project tests a Chromium mobile viewport;
it does not claim to validate native Safari. The tests cover layout/navigation,
missing configuration, authentication/session restoration, profile persistence,
and Firestore data isolation. GitHub Actions runs these checks after pushing.

## Setup status

- Complete: Next.js/TypeScript; Tailwind/shadcn; responsive layout/navigation.
- Complete: live Firebase Authentication and Cloud Firestore in `quizbowl-66145`.
  Email/password sign-in is enabled; localhost and 127.0.0.1 are authorized.
  Profile rules and indexes are deployed. Registration, profile persistence,
  sign-out, and sign-in passed a live check; temporary test data was removed.
- Complete: local Firebase web configuration, environment template, secret
  exclusions, Git repository initialization, and CI configuration.
- Optional measurement ID is configured; Google Analytics collection is not enabled.
- Pending: GitHub-to-Vercel connection and Vercel environment configuration.
  The deployment destination still needs to be selected.

References: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation),
[shadcn/ui](https://ui.shadcn.com/docs/installation/manual),
[Firebase web setup](https://firebase.google.com/docs/web/setup),
[Authentication emulator](https://firebase.google.com/docs/emulator-suite/connect_auth),
[Firestore emulator](https://firebase.google.com/docs/emulator-suite/connect_firestore),
[Vercel GitHub integration](https://vercel.com/docs/git/vercel-for-github).
