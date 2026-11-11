# Funding connectors and verified company links

The existing pipeline (Inc42, ET, Entrackr, YourStory, TechCrunch, Crunchbase News RSS; Tavily; GDELT; dedupe; city/sector enrichment) is unchanged.
This adds:

## Connectors (`lib/news/connectors`)
- Built in: TechCrunch India feed. Everything else is **configured**, not guessed: `FUNDING_EXTRA_FEEDS` (news), `FUNDING_OFFICIAL_FEEDS` (company press releases / investor
  announcements → stories marked **official**), `FUNDING_INVESTOR_FEEDS` (VC portfolio news). Format `Name|https://feed.url,Name2|https://…`, HTTPS only.
- RSS 2.0 and Atom. Dates: only a *publication* date is used (`pubDate`, `dc:date`, Atom `<published>`); Atom `<updated>` is ignored so an edited old article is not a new round.
  Stories older than 180 days are skipped; undated stories stay undated.
- Only stories that state a raise are kept (`isFundingArticle`); they go through the existing upsert, so URL / fingerprint / near-duplicate / same-round grouping applies.
  An official announcement of an already-known round upgrades that card to official and adds the source. A different round for the same company is not merged.
- Failures are isolated per connector, recorded in `funding_connector_runs` + `feed_health`, and never delete stored data (last-good data stays).
- Schedule: background refresh follows `FUNDING_NEWS_REFRESH_ENABLED/INTERVAL_MINUTES`; external schedulers run `npm run funding:refresh` (see docs/SCHEDULING.md).

## Verified links (`lib/news/company-enrich.ts`)
A domain is **never guessed**. Candidates come from links on the announcement page; a candidate is accepted only if the site's own title / og:site_name / h1 contains the
company's full name. Careers = a link on that site (own domain, or a job-board page carrying the company name) that loads over HTTPS. LinkedIn = `/company/<slug>` on the
verified site (or an announcement link whose slug is exactly the company name). Each field stores `{field, url, evidence}` and `lastVerifiedAt`; status is verified /
partially_verified / unverified. A careers URL never creates a job opening and funding never produces a hiring badge.
Storage is keyed by the full-name key (so "Zenith AI" and "Zenith Dental" cannot share links).

## Honest limits
No official/investor feed URLs are bundled: they could not be verified from the build environment, so add the ones you trust via env vars.
Live fetching of real feeds and real company sites was not performed in the build environment (restricted network); tests use mocked feeds and pages.
