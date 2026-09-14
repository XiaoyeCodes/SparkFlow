# Account research data reliability

Goal: make account research consume current, traceable public data and render readable articles without empty or scalar-field cards.

Architecture / ADR: use a bounded read-only capability router shared by the account research bridge and Vibe-Trading's auto-discovered tool registry. Do not add an unrestricted browser/shell agent or extra hidden model calls. Public providers receive ticker symbols only, never account balances or credentials. Existing model consent and usage accounting remain unchanged.

Stack: Python requests + existing public cache / SEC tools; TypeScript research checkpoints; React Markdown article rendering.

Decisions and tradeoffs:
- Domestic quote/profile and financial-indicator sources first; provider-specific symbol mapping (BRK B / BRK.B / BRK-B). Fall back by capability, validate identity, units and non-empty results.
- Keep report periods, start dates, currencies, provider timestamps and source URLs. Quarterly/cumulative/annual numbers must not be mixed. ETFs are not operating companies; incomplete look-through must be disclosed, not invented.
- Compact evidence structurally, never cut JSON in the middle or throw away the newest prices. Preserve raw evidence in saved research.
- Fetch official macro series and calendars directly before spending the news search budget. Search/read remains a supplementary source path, with publication dates retained.
- Financial/profile TTL differs from prices; cache only successful data. No paid provider, new credentials or external plugins required. Upstream free APIs can still delay, throttle or fail; preserve actionable limitations in collapsed details.
- Report normalization maps narrative aliases into a holding section; metadata is not a separate article card. Empty holdings disappear; diagnostics remain inspectable, collapsed by default.

Tasks and verification:
1. Add capability router, wire bridge and auto-discovered Vibe tool; test aliases, fallback, malformed/empty results, caching, latest periods.
2. Correct SEC IFRS and duration handling, domestic indicator fallback; verify actual public responses for representative stocks and ETFs.
3. Fix evidence budgets and source relevance; regression-test recent rows and source dates in the actual model prompt.
4. Remove empty/metadata cards, collapse diagnostics; browser-check desktop/mobile report and history scrolling.
5. Run unit/type/build/browser tests and a bounded synthetic-account analysis using the configured model (no order tools).
6. Create codex branch, inspect and commit all local source/test/docs changes (exclude runtime data/secrets/output artifacts), push and verify remote SHA. Shut down only after successful verification.

Non-goals: promising tick-level free data, inventing ETF constituent exposure, accounting returns from cash-inclusive NAV, changing account quote UI, or removing real financial uncertainty.
