# Redesign status

Verified: `tsc --noEmit` 0 errors, `next build` succeeds. NOT verified: any browser rendering, responsive widths, dark mode visually, DB-backed tests (`npm test` / `test:*-db`), Lighthouse/a11y.

## Done
- Tokens: indigo/yellow/lime palette (sampled from supplied screenshots), light + dark, new utilities. Plus Jakarta Sans headings.
- Shell: phone bottom tab bar (hidden in active interviews), restyled buttons (lime/sun variants), PageHeader panel with art, EmptyState with art auto-picked by icon.
- Dashboard: hero + overlapping quick-action tiles, matching DashboardSkeleton.
- 19 original SVG illustrations + generator. Skeletons + loading.tsx for dashboard, discover, atlas, news, interview, open-source.

## Added in the second round
- Restyled shadcn primitives: input, textarea, select (rounded white fields), tabs (lavender track, white active pill), badge (bold, mint/indigo tones), dialog (rounded-3xl).
- All listed component skeletons (text, button, avatar, search, illustration, page header, card, chart, table, activity timeline, dialog) and page skeletons (interview workspace/result, Atlas sources/conversation, repository detail, funding detail, profile, settings) in components/skeletons. loading.tsx now exists for settings, mock-interview (root, history, formal, voice), open-source/contribute. applications/loading.tsx now uses DiscoverSkeleton.
- Not yet wired into pages: AtlasSources/Conversation, FundingDetail, Profile skeletons exist but the pages still use their old inline loading states.

## Remaining
1. Visual QA in a browser at 1440/1280/1024/768/390/360, light and dark; fix contrast and overflow.
2. Page compositions still old (restyled by tokens only): AI Interview journey (intro/setup/active/processing/results/history), Atlas workspace layout, Open Source discovery and detail, Funding feed/detail, Profile/Settings, Discover, Applications.
3. Custom icon set (currently Hugeicons for everything), active/filled variants, tile treatment.
4. Wire the new skeletons into in-page loading states (Atlas panels, funding detail, profile) and verify they match final layouts at each width.
5. Editable quick links, daily insight card, "member since" line, share/download buttons (new features: need real data/actions).
6. Motion pass: page transitions, tab/dialog/dropdown, chart entrances, Atlas streaming, toasts.
7. Restyle sheet, table, switch, checkbox, toasts.
8. Landing page, login, onboarding still old styling.
9. Regression: run full test suites with PostgreSQL, browser regression scripts in scripts/e2e.
10. Confirm authorship/licence of the 4 legacy SVGs (now unused by EmptyState) or delete them. No Super.money assets were used.

## Third round (verified in a browser)
- Verified: `tsc --noEmit`, `next build`, `npm run test:all` (exit 0, PostgreSQL 16), and 192 captures (16 routes x 1440/1280/1024/768/390/360 x light/dark) with no horizontal overflow or page errors. Seeded Atlas data was also viewed.
- Fixed: skeleton bars were invisible app-wide (the `.shimmer` class collided with a text-shimmer utility in `shadcn/tailwind.css` and set `background-clip: text`). Renamed to `.sk-shimmer`, higher contrast, Atlas skeleton given a real height.
- Added: ScoreRing (interview result and per-answer score), compact Atlas source rows, tab count pills, skeleton wiring (Atlas, Applications, Facts, Open Source), switch/checkbox/table/sheet restyle, route entrance + tile hover motion (off for reduced motion), login hero panel, "Member since" in Settings.
- Removed: the 4 legacy SVGs in public/illustrations (unused; old paths are remapped in EmptyState).
- Not done: 3D artwork swap (needs files, see below), custom icon set, editable quick links, daily insight, Share/Download buttons, toasts (no toast system exists), browser regression script (needs seeded jobs), interview active/results states with a live AI provider.

## Fourth round
- 3D icons (3dicons, CC0) placed from public/illustrations/3d; profile now shown once (top-bar account menu only).
- Added "Show your work, don't just DM" (proof of work) card on the startup detail page: built from the company's own description and open roles, with a copyable brief. No invented data.
- Verified: tsc, next build, npm run test:all (exit 0).
- Still open: interview active/result screens with a live AI provider, Funding detail and Open Source detail/contribute layouts (token-restyled only), custom icon set, editable quick links, daily insight, Share/Download buttons, toasts, scripts/e2e regression (needs seeded jobs).

## Fifth round (all verified in a browser, tests pass)
- Interview: question, feedback and results screens checked end to end (local fake AI provider, QA only; not shipped). Compact header while in session, Download results (.txt).
- Toasts: components/kit/Toast.tsx (ToastProvider in AppShell, useToast). Used for copy, download, share.
- Share + Download: ShareButton (share sheet or copy link) on startup pages; proof-of-work brief download; interview results download. lib/client-download.ts.
- Dashboard: editable shortcuts (up to 4 of 7, remembered on this device via localStorage) and a "Today's focus" card derived only from the person's own numbers.
- Custom nav icon set: components/icons-nav.tsx, outline + filled states, used by sidebar, bottom bar and the command palette.
- 3D art: chat (Atlas), pin (Discover), wallet and tack (empty states) placed.
- Settings shows "Member since".
- Not done / not possible here: a separate Funding detail page does not exist in this app (stories link to their publisher); Open Source contribute page needs live GitHub access, which the sandbox blocks, so its layout is token-restyled only; scripts/e2e regression needs seeded jobs; icons outside the nav still use Hugeicons.

## Sixth round: ideas from the cold-email article + motion pass
- Draft coach (components/outreach/DraftCoach.tsx): live word count (aim 80-150, shorter for DMs) and the Context / Relevance / Proof / Small-ask checklist under the outreach draft. Signals only, not a score. Unit-tested in scripts/test-coach.ts.
- Outreach results (dashboard, shown once you have sent outreach): reply rate, positive replies, calls/interviews, each as a share of distinct companies contacted, using outcomes recorded in Applications (lib/analytics: outreach_contacted/replied/positive/meaningful).
- Motion: CountUp on dashboard metrics, GrowBar for result bars, stagger on funding stories, fade on tab content, rise-in for Atlas turns and each new interview question. All respect prefers-reduced-motion.
- Already existed, so not duplicated: outreach styles incl. follow-up, proof-of-work card on startup pages.
- Not changed on purpose: follow-up timing stays 7 days (the article suggests 3-5 business days; changing it alters tested behaviour, so it is a product decision).
- Open Source contribute page still needs a look with live GitHub access.
