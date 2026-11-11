# Super.money reference analysis (Phase 1)

Status: **partial**. This records what was actually inspected and what was not.

## Sources inspected
| Source | What was obtained |
|---|---|
| Medium case study by Amiya Chaturvedi (Apr 2025) | Full article text. **All images failed to load** (empty image links), so no screenshots, mockups or colours were seen. |
| Brucira agency case study for Super Money (brucira-v2.pages.dev) | Text only. States the brand uses a **3D illustration style**, **QR / 8-bit (pixel) motifs** ("own the QR element"), a "modern, quirky" tone, and icons/illustrations that encode product features. |
| App Store listing, press coverage | Text only; confirms positioning ("real cashback", uncluttered UX, sleek modern design). |

## Not done, and why
- **Palette: not extracted.** No hex values appear in any text source and no image could be retrieved. Any hex I list now would be invented, so none is listed. Needs: screenshots or a Figma/brand-guide export from you, or approval to sample the public site/app store screenshots.
- **Original asset reuse: not investigated.** The sandbox network only reaches package registries and GitHub, not super.money. No asset, font or CSS has been inspected and none has been reused. Licence status is unknown. Default per the brief: recreate with original Jyntra artwork.
- **Typography, icon treatment, shadows, animation: unknown** beyond the text claims above.

## Design principles that ARE documented in the case study (usable now)
1. Primary action is open on launch; identity (UPI ID) shown above it. Jyntra analogue: greeting plus one primary action in the first viewport.
2. Bento grid for main offerings; widths signal priority (small, medium, full-width).
3. User-editable quick links (pinned shortcuts).
4. Bite-sized daily insight ("Payper Cuts"). Analogue: one real career insight per day derived from existing data only.
5. One-stop hub with horizontally scrollable linked items and tabbed drawers.
6. Anchoring: best option first. Recognition over recall: show method, amount, recipient inline in history lists.
7. Progress bars on "continue" cards; categories to browse; quick takeaways atop long content.
8. Banner leading into a rewards/progress page; swipe-to-redeem; pending vs redeemable states.
9. Profile: identity block, primary action, referral nudge, categorised settings, loyalty line ("with us since…") near logout.
10. Share/Download placed as visible buttons, not hidden icons.

Brucira-documented brand traits to reproduce as original art: 3D-feeling illustrations, QR/pixel motifs, playful tone.

## Jyntra baseline (verified)
- Repo unpacked, `npm ci` succeeded, `npx tsc --noEmit` exits 0 (no errors before any change).
- Not run: `npm run build`, `npm test` (needs PostgreSQL and many suites), browser checks.
- A prior redesign pass exists: cream/terracotta/forest tokens in `app/globals.css`, `components/kit/*`, `components/shell/*`, 4 line-art SVGs in `public/illustrations/`, `components/PageSkeleton.tsx`, `CardSkeleton.tsx`.
- Route naming vs brief: Atlas = `/career-ai`, AI Interview = `/mock-interview`, Funding = `/news`, Profile = `/settings`. Route-level `loading.tsx` exists only for 10 routes; none for `/career-ai`, `/mock-interview/*`, `/news`, `/discover`.
- Navigation source of truth: `lib/nav.ts`. Companies and Hyderabad stay out of it (preserve).


---
# Update: visual analysis from the 7 screenshots you supplied

Colours below were **sampled from pixels** (small-patch averages) and rounded; anti-aliasing and gradients mean they are close, not exact brand values.

| Role | Sampled | Notes |
|---|---|---|
| Brand indigo (hero, big numerals, links) | #5b4ff5 (range #4c42fe to #5f56f2) | Dominant colour. Hero bg and amounts like "200" share it |
| Deep indigo (header on scrolled screens) | #2e2a97 | Darker header band |
| Electric yellow (scan chip, UPI ID chip, QR corner brackets) | #fdff1f | Used only for the primary scan affordance and highlights |
| Lime (primary CTA: Pay, Share, Copy card no.) | #b5ee85 | Pale lime CTA with near-black label, not white-on-colour |
| Page / sheet | #f9fbfc | Cool off-white, white cards on top |
| Keypad tray | #d0d6df | Cool grey |
| Tag magenta ("CLAIM NOW", BESTSELLER, FINANCE) | ~#e96af0 text/outline on pale pink | Tiny outlined tags |
| Tag green ("GET 20 CASH", TRENDING, PRIMARY) | ~#1f9d3a text/outline on pale green | Status/offer tags |
| Money green (illustrated notes) | ~#1f6d16 to #5ccf3a | Illustration only |

## Observed design language
- **Two-layer layout:** saturated indigo hero zone on top, a rounded white bottom sheet (with a grab handle) holding content. Scanner/primary action lives in the hero.
- **Type:** heavy, wide, geometric grotesque for headings and numerals (looks like a bold display sans such as Gilroy/Satoshi-class; **font not identified**), ALL-CAPS section labels with small centred headings ("FOR SUPER.YOU", "QUICK ACTIONS"), regular-weight lowercase UI labels (nav "home, manage, learn").
- **Bento hero cards:** pill-shaped glassy cards (rewards, superFD narrow; superCard full width) each with a 3D object on a pedestal, a label tab hanging under the card, and a magenta "CLAIM NOW" tag overlapping the top edge.
- **3D illustrations:** glossy, soft-lit isometric objects (cash stack on a light beam, vault, card, FD cube of notes, gift box). Indigo + lime + yellow + white. Matches Brucira's "3D illustration style" claim.
- **Icons:** thin 1.5px line icons, rounded joins, in 56px soft squircle tiles (#f9f9f9, subtle inner shadow). Selected = solid indigo tile with white check. Offer state = mint-tinted tile with green tag. Dashed tile with "+" for add.
- **Quick actions:** 4-column grid, editable (pencil), remove "x" badges in edit mode, search bar, category chips (recharges / utility / finances / other) with outlined active chip in indigo, "view all" tile.
- **Bottom nav:** 5 tabs, lowercase labels, active = black filled glyph + bold label, inactive grey.
- **Cards and lists:** white cards, 1px light border, ~12px radius, tags outlined; stat values in indigo bold ("9.0% p.a"); arrow-out icon in indigo square for external/detail.
- **Segmented tabs:** pale lavender track, white active pill with indigo label.
- **Alert/CTA rows:** full-width lime banner with illustration and arrow chip ("Get physical card").
- **Referral banner:** indigo panel with lime notes tucked behind its top edge, confetti, bold white copy.
- **Learn:** video card with highlighted caption (indigo/lime marker text), category icons as coloured pastel tiles, reading-progress bar at top in indigo, "Quick Takeaways" box with green checks.
- **Profile:** QR-style brand glyph tile, uppercase name, indigo copyable ID, banner, grouped list with indigo icon tiles, red logout, "member since" footer in indigo.
- **Pixel/QR motif:** pixelated QR corners, scan brackets in yellow.

## What this changes for Jyntra
The brief's "not cream/terracotta" is now answerable: tokens become indigo / yellow / lime on cool off-white. Remaining unknowns: exact typeface (will use an open-licence geometric display face and say so), exact shadows, motion.
