// Tunable thresholds. Change these instead of editing logic.
export const settings = {
  /** is_new_startup = founded_year >= this */
  newStartupFoundedYear: 2024,
  /** Startup-age buckets (by founded year, relative to newStartupFoundedYear) */
  earlyStageYears: 3, // founded within N years before the "new" threshold
  growingYears: 10, // founded within N years of today
  /** Funding buckets in days */
  fundingBuckets: [30, 90, 180] as const,
  /**
   * Only startups funded within this many days are added and shown (YC batches dated at Demo Day).
   * Older ones stay hidden unless the user saved, applied to or pinned them.
   */
  addFundedWithinDays: 90,
  /**
   * "New" = the source gave a posting date within the last N days. This is only the DEFAULT view: older roles that are
   * still listed stay searchable (Discover → Posted → "Any date"). A job with no posting date is never called "posted
   * recently": it is shown as "newly found" with its first-seen date, which is not a posting date.
   */
  newJobDays: 7,
  /** Dated postings older than this are not stored at all (they are almost always filled or abandoned). */
  maxListedJobAgeDays: 90,
  /** A listing the source has not re-confirmed for this long is flagged "not re-checked recently". */
  listingRecheckHours: 36,
  /** Match-score cut-offs */
  strongMatch: 65,
  potentialMatch: 40,
  /** Politeness: minimum ms between requests to the same host */
  perHostDelayMs: 1500,
  requestTimeoutMs: 25000,
  /** Extra attempts for 429 / 5xx / network errors (exponential backoff, Retry-After honoured). */
  retries: 2,
  /** Wall-clock limit for one source in one refresh (the run continues with the next source if it is exceeded). */
  sourceBudgetMs: 4 * 60_000,
  /** Max YC company pages fetched per discovery run (each is ~100KB) */
  ycMaxCompanyPages: 60,
  /** Himalayas: pages of 20 newest remote jobs open to India read per run */
  himalayasPages: 10,
  /** Funding news: article pages opened per feed to find the company website */
  fundingWebsiteLookupsPerFeed: 8,
  /** Max company websites checked for a careers page per run */
  maxCareersChecks: 25,
  /** Open source: YC pages read per run to find GitHub accounts, GitHub searches per run, accounts per search */
  ossMaxCompanyPages: 50,
  ossMaxSearches: 10,
  ossOrgsPerSearch: 8,
  /** Open source, popular projects: repos per run (GitHub repo search), repos per issue search, minimum stars */
  ossPopularRepos: 30,
  ossReposPerSearch: 6,
  ossPopularMinStars: 1000,
  /** Open source: only issues updated in the last N days are suggested */
  ossIssueMaxAgeDays: 180,
  /** Cache lifetimes */
  // Funding news and job boards are re-read on every new run (runs are at least 10 minutes apart);
  // the YC directory is a daily mirror, so a day-long cache loses nothing.
  cacheHours: { ycDirectory: 6, ycCompanyPage: 6, jobBoards: 0.2, himalayas: 1, rss: 0.1, robots: 24, githubSearch: 2, gdelt: 1 },
  /**
   * Live data: when anyone opens the app, data older than this is refreshed in the background and every open page
   * reloads itself when the refresh finishes. Runs share a database lock, so many visitors never start two at once.
   */
  live: {
    /** Jobs / startups: refresh when the last finished run is older than this. */
    discoveryStaleMinutes: 30,
    /** Funding news: refresh when the last successful read is older than this. */
    newsStaleMinutes: 15,
    /** After a failed run, wait this long before an automatic retry. */
    retryAfterFailureMinutes: 10,
    /** Browser polling: while a refresh is running / otherwise (only while the tab is visible). */
    pollRunningMs: 5_000,
    pollIdleMs: 30_000,
  },
  userAgent: "DailyStartupFinder/0.1 (personal job-search tool; respects robots.txt)",
};

export type Settings = typeof settings;
