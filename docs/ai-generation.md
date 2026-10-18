# Identifier generation

Use a Gemini Developer API key from a **free-tier project without billing** in
[Google AI Studio](https://aistudio.google.com/api-keys). Configure the private
server environment (locally `.env.local`, or your hosting provider's secrets):

```dotenv
GEMINI_API_KEY=your-private-key
GEMINI_MODEL=gemini-2.5-flash-lite
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
Configuration stays server-side. A missing key, model or opt-in fails closed.
Tests mock the provider and never consume the live free tier.

Provider references (checked 2026-10-18): [pricing](https://ai.google.dev/gemini-api/docs/pricing),
[project rate limits](https://ai.google.dev/gemini-api/docs/rate-limits),
[generateContent contract](https://ai.google.dev/api/generate-content).
