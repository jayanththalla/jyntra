# Contributing to Daily Startup Finder

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or idea
Open an [issue](https://github.com/SakshiGaikwad05/startup-finder/issues/new/choose) and pick a template.
For a bug, say what you did, what you expected, and what happened (a screenshot helps).

## Making a change
1. Fork the repo and create a branch: `git checkout -b fix/short-description`.
2. Set it up locally as described in the README ([Run it](README.md#run-it)).
3. Make your change. Keep it focused: one fix or feature per pull request.
4. Check it:
   ```bash
   npm run typecheck
   npm test
   ```
5. Open a pull request against `main` and fill in the checklist.

## Ground rules
- **Never commit secrets.** `.env` and `.env.local` stay on your machine; add new settings to `.env.example`
  with an empty value and a comment.
- **Keep scrapers polite.** Respect robots.txt, keep the per-host delay and the disk cache (`lib/http.ts`), and
  don't add sources that need a login or forbid scraping in their terms (e.g. LinkedIn, Wellfound).
- **Explain matches.** Any new scoring or classification rule should show its reason in the UI, like the
  existing "Why this match?" breakdown.
- **Match the existing style:** TypeScript, Tailwind classes, small components, no new dependency unless it's
  clearly worth it.
- **Tests:** if you change matching, location parsing, funding parsing or deduplication, add a case to
  `scripts/test-lib.ts`.

## Good first contributions
- New job-board or ATS sources (with public APIs)
- Better location / role parsing for edge cases
- Accessibility and mobile improvements

By contributing you agree that your work is released under the [MIT License](LICENSE) and that you'll follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
