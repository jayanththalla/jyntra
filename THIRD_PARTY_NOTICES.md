# Third-party notices

Jyntra's job-ingestion supply chain uses public data and techniques from the projects below.

## kalil0321/ats-scrapers — MIT
Source of the published ATS company inventories (`ats-companies/*.csv`) that `npm run jobs:discover-seed` downloads at run time
(they are not vendored into this repository), and of the Oracle/Eightfold/SuccessFactors response shapes studied for the adapters.

    MIT License — Copyright (c) 2026 Kalil Bouzigues
    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
    files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
    modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software
    is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

Only the MIT-licensed repository content is used. The separately hosted job dataset (`storage.stapply.ai/jobhive/…`) is **not**
downloaded, stored or redistributed: no data-use terms for it were found in the repository, so only its manifest is read.

## smresponsibilities/jobscraper_hourly — MIT
The technique of (1) downloading public ATS tenant lists, (2) validating every board against the real endpoint, (3) keeping only
India-relevant boards and (4) incremental Common Crawl discovery with a persisted page cursor (`pageSize=1`, JSON-lines, skipping
`impl*` Workday sandbox tenants) was adapted from `src/bulk-import.ts` and `src/discover.ts`. The Oracle Recruiting and Eightfold
adapters follow the response shapes handled in `src/fetchers/oracle.ts` and `eightfold.ts`. Code was re-implemented in TypeScript for
Jyntra's schema; this notice preserves the original licence.

    MIT License — Copyright (c) 2026 Shivam Mahajan
    (same MIT terms as above)

## elliottdehn/open-jobs — CC0 1.0
Evaluated as an optional one-time board-discovery input. Licence verified as CC0 1.0. The crawler stopped on 10 October 2026 and
the last snapshot is dated 5 October 2026, so historical jobs are never treated as current vacancies. **Not imported yet.**
