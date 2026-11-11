// Static metadata for every discovery source (seeded into the `sources` table).
export const SOURCE_DEFS = [
  {
    id: "yc",
    name: "Y Combinator directory",
    kind: "directory",
    baseUrl: "https://www.ycombinator.com/companies",
    notes:
      "Hiring-company list from the open yc-oss dataset (github.com/yc-oss/api), then each public YC company page for founded year, LinkedIn and job postings.",
  },
  {
    id: "himalayas",
    name: "Himalayas remote jobs",
    kind: "job_board",
    baseUrl: "https://himalayas.app/jobs/api/search",
    notes:
      "Documented public API (himalayas.app/api), no key required. Search with country=India returns remote jobs open to India (India-restricted or worldwide), newest first; cached 1 h (their data refreshes daily). Job links point to Himalayas and Apply uses their applicationLink unchanged. Can be switched off with HIMALAYAS_ENABLED=false.",
  },
  {
    id: "blrarena",
    name: "BLR Startup Arena",
    kind: "job_board",
    baseUrl: "https://www.blrstartuparena.com/api/companies",
    notes:
      "Optional (BLRARENA_ENABLED=true). Reads /api/companies/<slug>/jobs per company; companies without that endpoint are skipped, never treated as closed. Company list from /api/companies when available, plus BLRARENA_COMPANY_SLUGS or data/blrarena-slugs.txt. Not verified live.",
  },
  {
    id: "funding_rss",
    name: "Funding news (Inc42, ET, Entrackr, YourStory, TechCrunch, Crunchbase News)",
    kind: "news",
    baseUrl: null,
    notes:
      "Free public RSS feeds (robots.txt checked). Only headlines that state a raise are parsed; planned rounds and unconfirmed reports are labelled as such. The article URL is stored as the funding source.",
  },
  {
    id: "gdelt",
    name: "GDELT news discovery (optional)",
    kind: "news",
    baseUrl: "https://api.gdeltproject.org/api/v2/doc/doc",
    notes:
      "Secondary article discovery, OFF unless GDELT_ENABLED=true. Free, no key, limited to one request per 5 seconds; one request per refresh. Candidates must still pass the funding-headline parser; GDELT's first-seen time is provenance only and is never shown as a publication date.",
  },
  {
    id: "startupmaps",
    name: "Hyderabad startup dataset (GitHub, MIT)",
    kind: "directory",
    baseUrl: "https://github.com/shivtchandra/hydstartuplist",
    notes:
      "Open MIT dataset (about 1,200 Hyderabad startups, from startups.mapmyhyd.com, © Mapping HYD) read from raw.githubusercontent.com, cached 30 min. Gives name, website, description, address, sector, stage, founded year and careers link. Openings are used only when the dataset checked the board in the last 7 days. Replaces hyderabadstartupsmap.lol, whose robots.txt blocks /api/startups.",
  },
  {
    id: "fx_frankfurter",
    name: "Exchange rates (Frankfurter, ECB)",
    kind: "reference",
    baseUrl: "https://api.frankfurter.app",
    notes: "Free, no key. Converts INR/EUR/GBP amounts to USD for the amount filter. If unavailable, the original amount is shown.",
  },
  {
    id: "company_careers",
    name: "Company websites / careers pages",
    kind: "company",
    baseUrl: null,
    notes: "Looks for a careers link on a startup's own website and reads public Greenhouse / Lever / Ashby job-board APIs.",
  },
  {
    id: "oss_github",
    name: "Open-source projects (YC + GitHub)",
    kind: "open_source",
    baseUrl: "https://api.github.com/search/issues",
    notes:
      "YC companies tagged Open Source (yc-oss dataset); their GitHub account from the YC company page; then GitHub's public search API for open, unassigned good-first-issue / help-wanted issues. Optional GITHUB_TOKEN raises the rate limit.",
  },
  {
    id: "search",
    name: "Web search (Brave Search API)",
    kind: "search",
    baseUrl: "https://api.search.brave.com",
    notes: "Optional (needs SEARCH_API_KEY). Runs profile-based queries against public ATS job boards.",
  },
  {
    id: "tavily",
    name: "Tavily news search (optional)",
    kind: "search",
    baseUrl: "https://api.tavily.com",
    notes: "Optional (needs TAVILY_API_KEY). One bounded news query per refresh to supplement the RSS feeds; 1 credit per search, free plan 1,000 credits/month.",
  },
  {
    id: "google_cse",
    name: "Google Custom Search (deprecated)",
    kind: "search",
    baseUrl: "https://www.googleapis.com/customsearch/v1",
    notes: "Deprecated: Google closed this API to new customers and retires it on 2027-01-01. Runs only if GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX are already set.",
  },
] as const;
