# QBReader question reuse and attribution review

Reviewed 2026-10-17 against QBReader's
[API documentation](https://www.qbreader.org/tools/api-docs/),
[About page](https://www.qbreader.org/about/) and
[terms](https://www.qbreader.org/about/terms-of-service).

The API documents a 20-request-per-second limit. This application bounds question
retrieval, applies per-account API quotas and briefly caches deterministic answer
verdicts. Production operators should additionally set a deployment-wide ingress
limit if their aggregate traffic approaches the upstream limit.

QBReader collects packets from quizbowlpackets.com and parses them into its
database. Its terms describe a software MIT license and retain contributors'
rights to contributed content. We did not establish a blanket license for every
third-party packet from those pages. Software licensing must not be treated as
permission to relicense all questions or to redistribute an entire packet library.

Preserve each question's original source, full official answer, question identifier,
and original text alongside personal edits. Practice, decks, generated clue
evidence and Anki exports retain this information where upstream provides it.
Missing metadata is labelled QBReader database, not an invented author attribution.
Generated clues retain an exact excerpt and original answer binding; editing a
study clue does not replace its source evidence or claim authorship of the packet.

Operators should honor source packet restrictions, author/publisher requests and
question corrections. Review source packet permissions before public bulk or
commercial redistribution. School sharing is access-controlled; exports are user
downloads rather than a public packet mirror. Link users to QBReader for source
question reports and retain tournament/packet information when available.
