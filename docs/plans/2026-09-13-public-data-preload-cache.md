# Public Data Preload Cache Implementation Plan

**Goal:** Keep public market data ready on a Windows Mini, with bounded background refresh, restart recovery and fast repeat navigation, without sharing private data.

**Architecture:** A single-process, allowlisted public-resource cache sits before existing API handlers. Memory serves requests; versioned disk snapshots restore last-good data; a bounded scheduler refreshes hot resources even without visitors. Explicit frontend fetch helpers reuse only allowlisted public responses and never patch global fetch.

**Tech Stack:** Existing Node.js, TypeScript, React 18, filesystem snapshots, Playwright. No new runtime dependency or Redis.

## Task 1: Backend cache engine
- Create `server/publicDataCache.ts` and `scripts/verify-public-data-cache.mjs`.
- Test cold-request coalescing, nonblocking stale reads, bounded concurrency, failure backoff, hard expiry, disk recovery, corruption, byte limits and shutdown before integration.
- Retain source timestamps and respect payload validity boundaries. Save only successful, validated public payloads.
- Run `node --no-warnings --experimental-strip-types scripts/verify-public-data-cache.mjs`.

## Task 2: Resource policy and API integration
- Create `src/lib/publicDataPolicy.ts`, `server/publicDataHttp.ts`; modify `vite.config.ts`.
- Register finite canonical resource keys and hot priorities. Start/stop scheduler with server lifecycle. Do not prewarm every geography or symbol.
- Leave broker/account/trade, AI, custom subscription, mutation and stream endpoints outside the cache. Unknown query parameters cannot alias a cached resource.
- Expose read-only freshness/capacity status; never include credentials, private paths or upstream error strings.

## Task 3: Browser navigation reuse
- Create `src/lib/publicDataClient.ts` and a small cache freshness notice.
- Integrate explicit helpers in market/global/China data requests and isolated resource helper; remove forced refresh on initial public loads.
- Shared requests have independent caller cancellation. Enforce server expiry in browser cache; never persist personalized state.
- Keep loading/error/validity semantics of existing cards. Show stale-cache notice rather than pretending a snapshot is live.

## Task 4: Verification and handoff
- Add deterministic backend HTTP and frontend cache tests plus a browser navigation regression.
- Run `npx tsc -b`, cache tests, existing data-source tests and targeted Playwright tests; build with `npx vite build`.
- Document switches, coverage/exclusions, expiry, storage location, resource budget, cold-start behavior and Windows operation.
- Commit and push the completed feature on `codex/public-data-preload-cache`.

## Constraints
- The user already approved implementation of the discussed caching approach. No additional architecture approval or subagent work is needed.
- The referenced worktree helper skill is not installed; use the explicitly requested branch in the existing source-clean workspace, preserving `output/`.
- This is not a production-server migration, Cloudflare configuration change or Mini task installation.
