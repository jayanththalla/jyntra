# Funding news: how a story gets in

1. **Feeds** (`lib/news/feeds.ts`): Inc42, Economic Times (2), Entrackr, YourStory, TechCrunch (2), Crunchbase News. A failing feed never blocks the others; the last good copy is served from disk.
2. **Is it a startup raise?** `parseFundingHeadline` must find a company AND an amount or round. Rejected: shares/stake/bulk deals, acquisitions, VC *funds* raising money, IPO *events* (opens, subscribed, files for IPO, market debut), roundups ("Funding Galore"), promos, headlines about people ("Ex-Google engineers raise...").
   Accepted shapes: `Foo raises/bags/secures/attracts/pockets…`, `Accel leads $20 Mn Series A in AI startup Foo`, `Peak XV backs Chennai-based Foo with $10 Mn`, ranges (`$50-60 Mn`), `ahead of IPO` / `pre-IPO round`.
   Descriptors are stripped (`Foodtech major Rebel Foods` -> Rebel Foods). Anything unsure is dropped rather than guessed.
3. **Labelled, not mixed:** every story is `confirmed`, `planned` ("in talks to raise") or `rumored` ("reportedly"). The news page shows confirmed raises by default; one filter includes the rest, and they carry a badge.
4. **One card per raise:** the same URL is one row. The same raise written up by another outlet (different headline) is merged when the company matches, dates are within 45 days, and amounts agree within 20% (or the stage matches when an amount is missing). The card then says "Also reported by Inc42, YourStory" with links. A different stage is a different round. A confirmed report upgrades an earlier "planned" one.
5. **Honest data:** dates are the publisher's or "No date given"; amounts, rounds and investors come only from the headline/summary text. Currency conversion for matching is approximate and never displayed.

## Verified
`npm test` includes a 38-headline corpus. `scripts/test-news-db.ts` runs the real SQL (merge, upgrade, filters) against PostgreSQL; run it with `DATABASE_URL=...`.

## Not verified
The live feeds could not be reached from the build sandbox, so real-world headline coverage is measured only on the corpus. After deploying, run `npm run refresh`, then compare what `funding_articles` holds with the outlets' front pages for a few days and add any missed headline shape to the corpus in `scripts/test-lib.ts`.

## Provenance and links
Each article stores its original URL, publisher, date (or "not provided"), date source and the provider that saw it. Duplicates are merged by canonical URL and by headline fingerprint. Website, careers and LinkedIn links come only from trusted records and are otherwise shown as unverified or omitted; LinkedIn slugs are never guessed. A funding article is not proof of an open role. GDELT is optional (`GDELT_ENABLED=true`); RSS feeds remain primary and one failing provider never blocks the others.

## "Suggest stories for my profile"
`POST /api/news/suggest` (signed-in, AI rate limit). The model may only rank stories already retrieved from storage; ids are validated against that list, reasons are plain text with no links or amounts, and the result is labelled as AI-picked. Without an AI key, or if the model fails, it falls back to matching words from the profile. It never claims a company is hiring.
