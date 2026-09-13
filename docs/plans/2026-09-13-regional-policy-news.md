# Regional Policy and News Implementation Plan

> Execute in this session, preserving existing uncommitted map changes. The optional worktree helper is unavailable; no branch reset or automatic commit of user changes.

**Goal:** Fix provincial policy/news loading and give province/city/county inspectors one non-scrolling, ranked six-item layout per category.

**Architecture:** Extract a bounded government-page collector with region-verified portal discovery, shared parsing, title/URL deduplication, category ranking and per-region cache. Render two columns of three rounded cards per category, then expand additional results downward. Never count portal links as articles or mix parent-region results into a city.

**Tech Stack:** Existing Node/TypeScript fetch, React, CSS and Playwright; no new runtime dependencies.

## Approach

Preferred: government portal plus discovered category pages, with explicit regional seeds for special portals. Homepage-only parsing is cheap but incomplete; a general search feed has weaker geographic attribution and is not used as article evidence. Search may discover a portal only after the candidate page identifies the exact region.

## Tasks

1. Add parser/service tests (`scripts/verify-china-regional-feed.mjs`): real-title extraction, list navigation exclusion, URL/title dedup, publication dates, rank ordering, exact city portal checks, six-per-category collection, timeout argument regression, cache/coalescing and source failure.
2. Add `server/chinaRegionalFeed.ts`, integrate both existing API endpoints in `vite.config.ts`; retain bounded concurrency, TTL/backoff, article provenance and explicit incomplete results.
3. Share React policy/news card rendering in `ChinaMacroCommandCenter.tsx`; clear previous region immediately and support retry, counts and progressive loading skeletons.
4. Update only inspector/news CSS: no fixed/max height, no inner scroll or truncation, two columns on desktop and one on narrow screens, subdued emerald outlines, gold ranks, visible focus and reduced motion.
5. Add `tests/ibkr/china-regional-feed.spec.ts` for provincial/city consistency, expansion, long-title wrapping and no nested scroll. Run new tests, existing province/map tests, `npx tsc -b`, `npx vite build`; inspect screenshots and test Hubei/Nanyang live sources without starting broker services.

## Acceptance

## Follow-up: integrated inspector and diverse local reporting

- Remove the obsolete fixed inspector row; explicitly account for the regional-update row between the map and inspector. The outer card must contain all expanded content.
- Policy/news are integrated sections of one inspector, with equally stretched desktop columns and aligned bottom actions. Hide the main scrollbar without disabling wheel, touch or keyboard scrolling.
- Keep policies on government sources; add a nationwide media registry and regional news collection (livelihood, finance, tourism/culture, social issues and verified trending coverage). Official-portal failure must not block media news.
- Validate media domains, public DNS, redirects and exact regional relevance. Search can discover article URLs, but only fetched source pages supply article evidence. Never manufacture platform hot-search ranks.
- Share and bound source-page caching; diversify the first six news items while preserving emergency priority and publication freshness. Add category/source labels and tests for county isolation, failure independence, unequal content heights and actual card containment.

- Each category targets at least six unique real articles, with source and publication date where present. Unreachable or insufficient sources are reported honestly, not fabricated.
- First six render left 1–3, right 4–6; additional results grow the page vertically.
- Homepage links never occupy article slots; national news is not passed off as local news.
- Existing map edits, accounts, AI history and public-cache isolation remain intact.
