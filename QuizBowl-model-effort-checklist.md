# QuizBowl checklist: GPT-6.1 Sol reasoning recommendations

Use Low for routine UI and established patterns, Medium for ordinary integrations and feature logic, and High for security, concurrency, data correctness, and unfamiliar formats. These are task-specific recommendations, not official ratings.

The labels describe implementation effort assuming the database schema, permissions, and API contracts are already agreed. Use High once to design those foundations; then follow the item labels. Low UI work still uses the established authorization rules.

Extra High (xhigh): reserve for a stubborn bug involving several systems, a difficult concurrency failure, or a final cross-system architecture/security review. Max: no checklist item needs it as a starting setting. If your app exposes Ultra, do not start there for this project.

Keep each request to one coherent feature, reuse existing components, specify acceptance criteria, and request a concise completion report. Escalate when a task exposes deeper uncertainty; higher effort does not replace tests or source verification.

These labels select the coding assistant effort; they do not select the Gemini model used inside the app.

Official references: [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [Reasoning effort](https://developers.openai.com/api/docs/guides/reasoning).

## 1. Project Setup
- [x] **[Low]** Initialize Next.js with TypeScript
- [x] **[Low]** Configure Tailwind CSS and shadcn/ui
- [x] **[Medium]** Set up Firebase Authentication
- [x] **[Medium]** Set up Cloud Firestore
- [x] **[Low]** Configure environment variables and API keys
- [ ] **[Low]** Connect GitHub repository to Vercel
- [x] **[Low]** Create responsive website layout and navigation

Initialization status (2026-10-08): Firebase project quizbowl-66145 is connected through Git-ignored local environment variables. Email/password Authentication is enabled, local development domains are authorized, and Firestore profile rules/indexes are deployed. Live registration, profile persistence, sign-out, and sign-in were verified with a temporary account; the test account and profile were removed afterward. The GitHub-to-Vercel connection still requires the intended repository and Vercel destination; see README.md for setup steps.

## 2. User Accounts & Authentication
- [x] **[Medium]** Student login and registration
- [x] **[Medium]** Teacher/Admin login
- [x] **[High]** Role-based access permissions
- [x] **[Low]** Student profile management
- [x] **[High]** Automatic school membership (replaces invitations per user request); separate team workspaces
- [x] **[High]** Secure Firebase authentication and database rules
- [x] **[Low]** Account settings and preferences

Additional account requirement: administrator signup is protected by a private,
server-validated code. Task 2 is implemented and tested; the Firebase rules are
deployed, and the first admin account is created. The owner must verify their email
before staff access is enabled.

## 3. QBReader Question Practice
- [x] **[Medium]** Integrate QBReader API
- [x] **[Medium]** Fetch real tossup and bonus questions
- [x] **[Low]** Filter questions by difficulty (0–10)
- [x] **[Low]** Filter questions by category and subcategory
- [x] **[Medium]** Filter questions by specific topics
- [x] **[Low]** Select number of questions per session
- [x] **[Medium]** Support progressively revealed tossups
- [x] **[High]** Implement buzzing and typed responses
- [x] **[High]** Validate answers using QBReader answer checking
- [x] **[Low]** Display original answer lines and accepted alternatives
- [x] **[Medium]** Support multi-part bonus questions
- [x] **[Medium]** Track correct, incorrect, and skipped responses
- [x] **[Medium]** Avoid previously answered questions when requested
- [x] **[High]** Save all question attempts to Firebase
- [x] **[Low]** Display practice session summaries

## 4. Student Dashboard & Statistics
- [x] **[Low]** Display total questions attempted
- [x] **[Medium]** Track correct and incorrect questions
- [x] **[Low]** Calculate overall accuracy
- [x] **[Medium]** Show accuracy by category and subcategory
- [x] **[Medium]** Show performance by difficulty
- [x] **[Medium]** Track questions attempted daily, weekly, and monthly
- [x] **[Medium]** Visualize progress with interactive charts
- [x] **[Low]** Display recent practice sessions
- [x] **[Low]** Show upcoming assignments and competitions
- [x] **[Medium]** Recommend weak subjects for additional practice

Task 4 is available at `/dashboard`. Statistics are individual to the verified
logged-in account; switching accounts clears the previous dashboard. Question
counts deduplicate bonus parts within each session, while correct/incorrect and
accuracy use individual responses (matching task 3). Activity follows the
student's timezone. Upcoming items are filtered by school membership, publication,
date, and student/team audience; authoring these items remains in tasks 10 and 11.

## 5. Question History
- [x] **[Low]** Display the 30 most recent question attempts
- [x] **[Medium]** Save complete attempt history in Firestore
- [x] **[Low]** Filter history by subject and difficulty
- [x] **[Low]** Filter correct and incorrect responses
- [x] **[Low]** Display submitted answers and official answer lines
- [x] **[Medium]** Retry previously missed questions
- [x] **[Medium]** Add questions from history to decks
- [x] **[High]** Prevent duplicate history submissions

Task 5 is available at `/history`. It reads the complete Firestore history saved
by task 3, displays 30 attempts per page with older-history navigation, and supports
subject, subcategory, difficulty 0–10, and outcome filters. Bonus parts are separate
attempts; clarification submissions remain visible with the full original question.
Missed-question retries create a new saved practice session using the original
question, including all bonus parts. Questions can be saved to new or existing
personal decks and viewed at `/decks`. Submission IDs are now bound to one response
per account through private receipts committed atomically with history and session
totals. Repeated requests replay their original verdict without adding records or
scores; conflicting reuse is rejected. Deliberate retries in new sessions still
count as new practice. All of task 5 is complete.

## 6. Custom Study Decks
- [x] **[Medium]** Create, rename, edit, and delete decks
- [x] **[Medium]** Create topic-based study decks
- [x] **[Medium]** Create saved-question study decks
- [x] **[Medium]** Create a default Starred Questions deck
- [x] **[Medium]** Star questions directly from the practice reader
- [x] **[Medium]** Add questions to one or multiple decks
- [x] **[Medium]** Save original QBReader questions and answer lines
- [x] **[Low]** Support custom topic tags
- [x] **[Low]** Browse and search saved cards
- [x] **[Low]** Flip through full-question flashcards
- [x] **[Low]** Edit or remove saved cards
- [x] **[High]** Support private and team-shared decks

All of Task 6 is complete at `/decks`. Create empty or
topic-populated decks, edit names/descriptions/tags, search saved questions,
and flip through full-question flashcards. Practice supports direct starring;
practice, history, and saved cards support multiple deck destinations. Original
questions and every official answer line are retained separately from editable
study text. Deck and card deletions require an inline confirmation. All access
enforces deck ownership for all edits. Decks are private by default; owners can
share with their configured school and revoke sharing. Current school members
can study shared decks and copy original cards to their own decks. Shared reads
and copies check membership and live visibility transactionally. Sharing,
revocation, and deletion update the school directory atomically. Starred
Questions stays private. No AI generation is added.

## 7. AI Identifier & Flashcard Generation
- [ ] **[Medium]** Integrate Gemini API free tier
- [ ] **[High]** Trigger AI only when a question is starred or added to a deck
- [ ] **[High]** Never call AI during ordinary question fetching or answering
- [ ] **[High]** Never call AI just to reveal an existing answer line
- [ ] **[High]** Check Firebase cache before every AI generation
- [ ] **[Medium]** Generate simple/giveaway identifiers
- [ ] **[Medium]** Generate intermediate identifiers
- [ ] **[Medium]** Generate complex/early-buzzer identifiers
- [ ] **[High]** Convert individual clues into self-contained flashcards
- [ ] **[High]** Preserve the official QBReader answer line for each clue
- [ ] **[High]** Include original source excerpts for verification
- [ ] **[Medium]** Classify clues by complexity
- [ ] **[Low]** Allow students to preview and edit generated cards
- [ ] **[Low]** Allow students to remove inaccurate clues
- [ ] **[High]** Cache generated clues for reuse across students
- [ ] **[High]** Prevent simultaneous duplicate AI generation requests
- [ ] **[Medium]** Track generation status: pending, generating, completed, failed
- [ ] **[High]** Handle API rate limits and generation failures
- [ ] **[High]** Set per-student AI generation quotas
- [ ] **[High]** Support manual retry or regeneration when needed

## 8. Anki Integration
- [x] **[High]** Export custom decks to Anki APKG format
- [x] **[Low]** Support CSV export
- [x] **[Medium]** Export full tossup question cards
- [x] **[Medium]** Export individual AI-generated identifier cards
- [x] **[Low]** Allow export by category and difficulty
- [x] **[Low]** Allow export by clue complexity
- [x] **[Medium]** Preserve official answer lines and question formatting
- [x] **[Low]** Include category, subcategory, and topic tags
- [x] **[Low]** Include tournament/source information when available
- [x] **[High]** Use stable Anki note identifiers to reduce duplicates
- [x] **[Low]** Allow students to download and import exported decks
- [x] **[High]** Test Anki exports for formatting and duplicate handling

All twelve Task 8 subtasks are complete at `/decks`. APKG packages and CSV
support full questions and saved identifier cards, category/difficulty/complexity
filters, official answers, formatting, subject/topic tags, and source attribution.
Stable source-based note identities are shared across formats and deck copies.
APKG downloads include the QuizBowl v1 note type; import it once before CSV.
The export endpoint transactionally checks current ownership or sharing access.
Anki 26.9.3 backend tests verify rendering, repeated and filtered imports,
question/clue edits, cross-format updates, and preserved review scheduling.
Anki uses whole-second APKG revision timestamps; re-download after a second
if a rapid edit did not refresh a note. Task 7 generation is still pending:
identifier export reads saved results only and makes no AI calls. Older saved
questions keep their stored plain text; new questions retain basic formatting.

## 9. Teacher/Admin Dashboard
- [x] **[Medium]** Display all authorized team members
- [x] **[Medium]** View individual student statistics
- [x] **[Medium]** Track total questions attempted per student
- [x] **[Medium]** Track correct and incorrect attempts
- [x] **[Medium]** Compare accuracy across subjects and difficulties
- [x] **[Medium]** Show daily, weekly, and monthly practice activity
- [x] **[Low]** Visualize performance trends
- [x] **[Low]** Create subject-by-difficulty heatmaps
- [x] **[Medium]** Identify weak topics and areas for improvement
- [x] **[Medium]** Monitor student participation
- [x] **[Low]** View assignment completion
- [x] **[Medium]** Track student deck and review activity
- [x] **[Low]** Export individual and team statistics to CSV

All thirteen Task 9 subtasks are complete at `/team`. Verified school teachers
and administrators can view the full member roster, individual and team student
statistics, subject/difficulty comparisons, daily/weekly/monthly activity,
interactive trends, heatmaps, weak areas, participation, assignment completion,
deck inventory and in-site flashcard reviews, and individual/team CSV exports.
Staff access and current membership are checked server-side; other schools'
data and private card contents are excluded. Assignment completion reads saved
published assignment progress; authoring and automatic updates remain task 10.
Review tracking starts with this feature and covers in-site answer reveals;
Anki review synchronization remains task 14. Unit tests, Firebase rules tests,
desktop/mobile emulator browser tests, lint, typecheck, formatting, and a fresh
production build pass. See README.md for the assignment progress contract and
counting rules.

## 10. Teacher Assignments & Shared Decks
- [x] **[Medium]** Create practice assignments
- [x] **[Medium]** Assign work to individual students
- [ ] **[Medium]** Assign work to student groups or the entire team
- [ ] **[Low]** Set question counts and difficulty ranges
- [ ] **[Low]** Set category, subcategory, and topic requirements
- [ ] **[Low]** Set assignment deadlines
- [ ] **[High]** Automatically track assignment progress
- [ ] **[Low]** View student completion and performance
- [ ] **[Medium]** Create teacher-curated study decks
- [ ] **[High]** Share teacher decks with students
- [ ] **[Medium]** Allow students to practice and export shared decks
- [ ] **[High]** Prevent unauthorized edits to teacher-created decks

## 11. Team Calendar & Announcements
- [ ] **[Medium]** Build a shared team calendar
- [ ] **[Medium]** Allow admins to create and edit events
- [ ] **[Low]** Add competition and tournament dates
- [ ] **[Low]** Add team practice schedules
- [ ] **[Medium]** Add assignment deadlines
- [ ] **[Low]** Add tournament locations and descriptions
- [ ] **[Low]** Allow students to view team events
- [ ] **[Medium]** Support optional event RSVPs
- [ ] **[Low]** Display upcoming events on dashboards
- [ ] **[Low]** Create team announcements
- [ ] **[Medium]** Add optional calendar export or synchronization

## 12. Firebase Database & Backend
- [ ] **[Medium]** Create user profile collections
- [ ] **[High]** Create secure student attempt history collections
- [ ] **[Medium]** Create study deck and saved-card collections
- [ ] **[High]** Create AI-generated clue cache
- [ ] **[High]** Create daily statistics summaries
- [ ] **[Medium]** Create practice session records
- [ ] **[Medium]** Create assignments and progress collections
- [ ] **[Medium]** Create calendar and announcement collections
- [ ] **[Medium]** Build Next.js API routes for QBReader
- [ ] **[High]** Build server-side answer validation and attempt recording
- [ ] **[High]** Build secure AI generation endpoint
- [ ] **[High]** Build Anki export endpoint
- [ ] **[High]** Implement API caching and rate limiting
- [ ] **[High]** Implement Firestore security rules and role checks
- [ ] **[High]** Protect API keys and admin credentials
- [ ] **[High]** Implement duplicate submission prevention
- [ ] **[High]** Handle student data privacy and retention
- [ ] **[Medium]** Review QBReader question reuse and attribution requirements

## 13. Testing & Deployment
- [ ] **[Medium]** Test student and admin authentication
- [ ] **[High]** Test role-based permissions and data isolation
- [ ] **[Medium]** Test QBReader filters and question retrieval
- [ ] **[High]** Test answer checking and scoring
- [ ] **[High]** Test question history and statistics accuracy
- [ ] **[Medium]** Test starring and deck creation
- [ ] **[High]** Verify AI runs only after starring or saving
- [ ] **[High]** Verify cached clues do not trigger repeated AI calls
- [ ] **[High]** Test generated clue quality and validation
- [ ] **[High]** Test Anki APKG and CSV imports
- [ ] **[Medium]** Test calendar and assignment functionality
- [ ] **[Low]** Test responsive layouts on desktop and mobile
- [ ] **[High]** Test Firebase and AI usage limits
- [ ] **[Low]** Deploy production website to Vercel
- [ ] **[Low]** Set up error logging and basic monitoring

## 14. Future Improvements
- [ ] **[High]** Spaced repetition scheduling
- [ ] **[High]** Adaptive question recommendations
- [ ] **[Medium]** Answerline Explorer for recurring clues
- [ ] **[High]** Live multiplayer quizbowl practice rooms
- [ ] **[High]** Real-time buzzing and team scoring
- [ ] **[Medium]** AI explanations for difficult clues
- [ ] **[High]** Anki review progress synchronization
- [ ] **[High]** Optional support for multiple school teams
