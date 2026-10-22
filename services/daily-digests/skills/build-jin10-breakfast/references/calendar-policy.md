# Independently verified run calendar

The quote itself cannot certify the market calendar. A provider's final daily bar may be partial, delayed, or dated before a holiday. Before deciding which price is eligible, the executing agent must read the relevant official current-year trading schedule, holiday calendar, early-close rules and current exception notices. Calendar evidence must be freshly accessed and retained during the run. No bundled hardcoded holiday dates or weekday-only calendar is a production authority.

## Official sources to access

- Nasdaq Composite: [Nasdaq market holiday schedule](https://www.nasdaq.com/market-activity/stock-market-holiday-schedule), current official market-hours and current notices as needed. Calendar ID `NASDAQ`, timezone `America/New_York`.
- S&P 500 cash price index: [Cboe hours and holidays](https://www.cboe.com/about/hours/), matching US regular cash-index publication schedule, not overnight derivatives sessions. ID `CBOE_SPX`, timezone `America/New_York`.
- MAGS US Cboe BZX listing: [Cboe hours and holidays](https://www.cboe.com/about/hours/), BZX US equity regular session and early-close notices. ID `CBOE_BZX`, timezone `America/New_York`.
- Shanghai Composite: [SSE schedule](https://english.sse.com.cn/start/trading/schedule/) and [SSE market closure notices](https://www.sse.com.cn/disclosure/dealinstruc/closed/). ID `SSE`, timezone `Asia/Shanghai`. Verify the current applicable morning/afternoon sessions and lunch pause, including exceptions; do not infer trading on a government make-up workday.
- Hang Seng: [HKEX calendar](https://www.hkex.com.hk/news/hkex-calendar?sc_lang=en) and the [securities-market operations FAQ](https://www.hkex.com.hk/Global/Exchange/FAQ/Securities-Market/Trading/Securities-Market-Operations?sc_lang=en). ID `HKEX`, timezone `Asia/Hong_Kong`. Use securities/index regular-session context, not the futures overnight session. Verify lunch and half-day/closing-auction effects.
- Paxos Bitcoin spot: current official Paxos/IBKR crypto trading-hours and maintenance/exception notices. Start with [IBKR crypto definition](https://www.interactivebrokers.com/docs/tws-api/contracts/cryptocurrency); find the current official hours page. ID `PAXOS`, timezone `Etc/UTC`, mode `continuous` only after 24-hour access and no active exception are verified. Continuous crypto does not require an invented exchange holiday schedule.
- London spot gold via IBKR: official current contract trading hours/session definition and maintenance/holiday exceptions from [IBKR](https://www.interactivebrokers.com/). ID `IBKR_GOLD`, timezone `America/New_York` for this provider's source-session policy. Verify the exact source daily-session boundary; do not borrow COMEX or LBMA auction times. If the supported broker definition differs, investigate/update the contract rather than mislabel it.
- ICE Brent: [ICE Brent specification](https://www.ice.com/products/219/Brent-Crude-Futures), its linked current trading-hours, holiday and expiry notices. ID `ICE_BRENT`, timezone `Europe/London`. Verify overnight/session-ending date convention, daylight-saving offsets, early closes, and contract final-trading cutoff. Do not hardcode either London UTC offset or a fixed 01:00 open year-round without current verification.
- Treasury CMT: [official yield table](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve), the linked Treasury methodology/publication information, and current official Treasury/federal holiday context. [OPM holidays](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/) can support federal holidays, not establish Treasury publication by itself. ID `US_TREASURY`, timezone `America/New_York`, mode `publication`.

Source URLs are starting points. Follow the official links to the current applicable year and notices, and preserve the actual URLs accessed. A page title saying “holiday schedule” without the relevant year does not verify that year. If the run crosses New Year, verify both relevant years. Current-year confirmation alone does not prove no emergency closure; inspect current notices when deciding the actual session. A network denial is not permission to bypass the source.

## calendar.json common envelope

`quote_contract.py init` creates the run binding. Keep its `schema`, `run_id`, and `request_sha256` unchanged. Set `evaluated_at` to the same actual UTC collection cutoff as `quotes.json.collected_at` and `manifest.collection_finished_at`.

`calendars` contains one record per calendar needed by a verified asset; unavailable assets need no invented calendar. Each record contains:

- `calendar_id`, `timezone`: exact identifiers listed above.
- `mode`: `sessions`, `continuous`, or `publication` as specified.
- `years`: integer list of all applicable source-calendar years, including prior year when coverage crosses January.
- `sources`: nonempty list of `{url, roles, evidence_file, evidence_sha256}`. Paths are relative to the run directory; each must match a preserved current-run manifest call and SHA-256. URLs must be official for this calendar. Multiple roles may refer to one actual source if its content supports them.
- Source roles for sessions: `hours`, `holidays`, `exceptions`. For continuous: `hours`, `exceptions`. For publication: `publication`, `holidays`, `exceptions`. A role is an evidence claim to substantiate from the retrieved content, not a way to bypass a missing source.

All timestamps use full ISO-8601 date/time with UTC offset. Use IANA timezones when generating them. Never use naive local times or derive US/London offsets from the report's Beijing date.

## Session calendar records

Additionally include:

- `coverage_start`, `coverage_end`: ISO dates, covering at least the prior 14 calendar days through the current local date. Extend farther when needed to find two completed sessions. Keep the total span no more than 400 days.
- `days`: exactly one record per date in that continuous range, including weekends and holidays. Each record is `{date, intervals, early_close, closure_reason}`.
- `date`: the session-ending local date. `intervals` is an ordered list of `{open_at, close_at}` timestamps. A regular equity day can contain morning and afternoon intervals. An overnight session may start the previous local date; its close must land on `date`.
- `early_close`: explicit boolean. If true, use the source-supported actual early close in `close_at`, not the ordinary close.
- Nontrading days have `intervals: []` and a supported `closure_reason` such as the official holiday name or weekend. Empty intervals cannot silently mean “data missing.”

Populate these records by applying the verified official schedule and exceptions to actual dates, not by reading the quote's last row. Retain enough evidence for a reviewer to verify the transformation.

The validator derives the market state at `evaluated_at` from these intervals:

1. Inside a regular interval: `open`.
2. Between two same-session intervals: `break`.
3. Otherwise: `closed`.

It derives the latest and preceding fully completed session dates from the final interval end, not from requested/observed quote dates. Missing calendar dates, overlapping intervals, timezone mismatches or unsupported sources invalidate affected rows.

For open/break equities, the denominator is the latest prior completed regular close. For closed equities, numerator and denominator are the latest and preceding completed regular closes. At lunch, the morning is not a completed daily session. A delayed morning quote may be retained only with verified break bounds and source timestamp satisfying the renderer's morning freshness policy. The current implementation accepts regular SSE lunch 11:30–13:00 and HSI lunch 12:00–13:00 local after independent evidence confirms them; if an official exceptional schedule differs, fail that row safely instead of forcing those usual bounds.

The raw source daily-bar boundary can precede its economic session date. For gold/Brent explicitly document that mapping. Never convert a provider bar start into a fabricated exchange close timestamp.

## Continuous Paxos calendar

No `days` list is needed. Set `continuous_24h_verified: true` and `active_exception: false` only when supported by the current official evidence. If an active outage/maintenance affects the current observation, mark BTC unavailable or investigate; do not claim continuous availability. The quote still needs a complete minute and exactly matching minute 24 hours earlier.

## Treasury publication calendar

Do not invent an exact publication time or treat an equity trading calendar as Treasury publication policy. Set:

- `latest_publication_verified: true` only after checking the fresh official table and applicable publication/holiday context.
- `latest_published_date`, `previous_published_date`: the two latest actually published, official dated observations at the cutoff.

These must match the Treasury row and be ordered, not in the future, with relevant years verified. If today's expected observation has not yet appeared, retain the true latest publication date only after checking the official publication timing; do not label it “live.” The validator rejects an observation more than seven calendar days old, prompting investigation rather than silently serving it. The fresh official response, not a helper's guessed release clock, proves which observations are actually published.

## Evidence limits

Hashes and run IDs detect mismatched/replayed files and stale timestamps; they cannot prove that an agent actually called a tool or correctly interpreted a page. The executing agent remains responsible for fresh calls, honest timestamp recording, correct current-year interpretation, and accurate source-to-calendar extraction. Do not manually “repair” the date, hash, run ID, or timestamp of old evidence to manufacture freshness.
