# Market input contract: fresh, agent-collected, evidence-backed

This is the complete producer contract for `scripts/quote_contract.py`. The helper is an offline validation bridge between the executing agent's real tools and the report renderer. It does not retrieve market data. It does not guarantee a connector, public API, entitlement, or signup-free quote source for every asset. Read `sources.md` and `calendar-policy.md` before filling the files.

## Execute one current run

From the skill directory, with Python 3.10+ and IANA timezone data available, choose a new report directory `RUN`. Prepare the current news first, then initialize the nested market directory:

```sh
python scripts/jin10_breakfast.py prepare --out RUN
python scripts/quote_contract.py init --run-dir RUN/market
```

Choose a new report directory on every execution; its nested `RUN/market` must not already contain files. Do not initialize the populated outer report directory. `init` refuses to overwrite an existing run. It reads the execution machine's actual UTC clock, assigns a random run ID, and writes:

- `request.json`: current start, required nine identities/units/baselines, immutable run ID.
- `quotes.json`: all nine required rows with `status=pending`; no prices or historical timestamps.
- `calendar.json`: empty independently verified calendar envelope.
- `evidence/manifest.json`: empty raw-call manifest.

Verify the host clock is trustworthy before starting; a future/incorrect machine clock is a blocker, not permission to copy a sample date. The production CLI deliberately has no date override, sample-data option, or quote generator. Python test fixtures use injected time only for deterministic invariant testing and are not report inputs.

Next, the agent must discover actual available tools, retrieve fresh quotes and official calendars, preserve responses, and fill the contract below. Obtain a real final UTC cutoff after source retrieval. Set the three collection/evaluation finish fields to that exact cutoff. Then:

```sh
python scripts/quote_contract.py validate --run-dir RUN/market
python scripts/jin10_breakfast.py render --out RUN --market-run RUN/market
```

Success writes `market.normalized.json` in that run directory and prints `ready` or `ready_degraded` with a verified count and failure reasons. `--output` may select another local result path, but evidence references remain relative to the original run directory. The production renderer accepts `--market-run RUN/market` and revalidates it before rendering. Raw `--quotes` and `--evidence-root` inputs are reserved for explicit `--preview-only` historical/demo use; they are not a production bypass.

Exit code 2 means the market-data step failed. No normalized file is newly produced on failure. Do not render an old existing normalized file after a failed validation. Use a fresh output directory and gate rendering on this command's successful exit.

All-unavailable is a hard failure. A partial run may render verified rows and `暂无可信报价` for the rest, with the workflow surfacing that coverage was partial. Pending or malformed rows become unavailable; if nothing remains verified, validation fails. A snapshot/run older than 20 minutes is rejected even if it contains valid historical closes. If collection runs longer than 20 minutes, start a new run and retrieve evidence again; never just edit the clock fields or run ID. Read static methodology before initiating the timed run to avoid unnecessary expiration.

## Common run envelope

`request.json`, snapshot, calendar, and manifest use `schema: "jin10-agent-quotes/1"`. The three produced files must copy the exact `run_id` and `request_sha256` initialized for this run. The request hash is SHA-256 of the unchanged `request.json` bytes. Do not modify the initialized request, asset list, or 1,200-second freshness limit.

`quotes.json` has:

- `schema`, `run_id`, `request_sha256` as above.
- `collected_at`: actual timezone-aware ISO-8601 collection cutoff, normally UTC ending in `Z`.
- `quotes`: exactly one row for each ID: COMP, SPX, MAGS, SSE, HSI, BTCUSD, XAUUSD, BRENT, US10Y. No duplicate, omitted, renamed, or extra asset.

`calendar.json` uses the same binding plus `evaluated_at` and `calendars`, fully specified in `calendar-policy.md`.

`evidence/manifest.json` uses the same binding plus:

- `run_started_at`: exactly the request start.
- `collection_finished_at`: exactly snapshot `collected_at`.
- `queries`: one record per preserved source call. Each is:
  - `run_id`: the current run ID.
  - `key`: nonempty unique local identifier.
  - `tool`: exact actual callable tool name, not an invented API.
  - `args`: the exact argument object actually submitted. No credentials, account balances, user email, delivery IDs, or unrelated private data should be collected for this task.
  - `source_urls`: nonempty list of verified public HTTPS URLs identifying the source/page/instrument. Broker connector data may cite its official instrument definition plus any relevant provider documentation; do not invent a public API URL for a private connector.
  - `requested_at`, `fetched_at`: observed call start/completion UTC timestamps, with start ≤ completion. A batch-completion upper bound is acceptable if described in optional `fetched_at_precision`; do not pretend it is the exact individual response time.
  - `evidence_file`: a nonempty relative path from the run directory, conventionally `evidence/<key>.json`. No absolute host paths or traversal outside the run.
  - `evidence_sha256`: SHA-256 of the unmodified response file bytes.

Every evidence call must begin on/after the current run start and finish on/before collection cutoff (at most five seconds clock skew). Preserve tool responses, including errors if useful, without rewriting them into asserted prices. A manifest is an audit trail, not cryptographic proof of a network call. Honest fresh retrieval remains the agent's responsibility.

## Unavailable rows

Keep `id`, `run_id`, `status: "unavailable"`, and a specific truthful `reason`. Retain the initialized identity/unit/baseline if useful. Do not keep `value`, `previous_value`, `quote_at`, or `asof_date` from any failed or earlier observation. Examples of appropriate reasons are “Connected quote tool lacks the required market-data entitlement” or “Fresh public page did not expose a timestamped, corroborated Shanghai index value.” Do not claim a failure is temporary unless known.

## All verified rows: required fields

- `id`, current `run_id`, `status: "verified"`.
- `instrument_id`, `calendar_id`: exact initialized values, detailed in `sources.md`.
- `instrument`: truthful full instrument description, including spot/index/ETF/future and provider context.
- `unit`: exactly the unit in the initialized request.
- `baseline`: exact expected comparison: `regular_close` (the five equities/indexes), `rolling_24h` (BTC), `previous_close` (gold), `provider_daily_close` (Brent), `yield_previous_observation` (Treasury).
- `value`, `previous_value`: positive finite numeric values or numeric decimal strings, same instrument/units/contract definition. Booleans, zero/negative values, NaN and Infinity are invalid. Preserve full source precision.
- `source_name`, `source_url`: source/provider name and public HTTPS provenance URL. It must appear in the current evidence call's `source_urls`.
- `data_route`: `ibkr` or `public_web`.
- `fetched_at`: exactly the completion bound of the primary quote evidence call, not the quote time.
- `evidence_file`, `evidence_sha256`: primary quote raw response, present in the current-run manifest.
- `calendar_verified: true`, `session_timezone`, `market_state`: facts supported by the run calendar. Allowed states are `open`, `break`, `closed`, or `official_daily` for Treasury. The validator derives and checks the state rather than trusting this assertion.
- `source_delay_status`: `declared`, `not_declared`, `declared_unspecified`, or `official_daily_not_live`.
  - `declared` requires a nonnegative numeric `source_delay_seconds` from the source; it is not a cached constant from a prior run.
  - `not_declared` requires absent/null `source_delay_seconds`; unknown delay is not zero.
  - `declared_unspecified` requires a truthful `delay_disclosure`. The current renderer accepts this special case only for SSE's verified lunch delayed quote; otherwise a missing specified delay fails safely.
- For `data_route=ibkr`, `provider_contract: {contract_id, exchange, security_type}` matching the exact benchmark. The primary evidence query arguments must use the same contract ID and exchange. Brent is dynamically resolved; the others use verified seeds in `sources.md`.

Additional provenance fields are allowed and kept internal. Whenever another `*_evidence_file` field is present, its matching `*_evidence_sha256` must match a preserved current-run query. Do not add a claimed evidence field without the actual response.

## Completed daily observations

For `quote_kind=regular_close` (closed equities), `official_daily` (Treasury), or `session_close` (eligible gold/Brent fallback), provide:

- `asof_date`: true session-ending/publication ISO date.
- `previous_date`: preceding completed/published observation date.
- `expected_session_date`: the independently derived latest completed/publication date, exactly matching `asof_date`.
- `session_complete: true`.
- If useful, `source_bar_time` and an explanation of what the raw boundary means. Do not invent a close timestamp for date-only data.

The validator compares dates to the independently derived calendar, including holidays and early closes. Open or lunch equities may not substitute the previous day's close. Gold/Brent `session_close` is allowed only when the verified venue is closed, or just opened and still within an explicitly declared source-delay window. Keep `quote_basis`, `baseline_disclosure` and any non-live fallback explanation internally. An old quote alone never establishes closure.

## Open or lunch intraday observations

Allowed `quote_kind` values: `live`, `delayed`, `bar_close`.

- `quote_at`: actual source quote timestamp; for minute bars it is the interval end, not an exact trade timestamp.
- `previous_date`: independently expected latest completed source session, except BTC uses exact `previous_at` below.
- If `quote_kind=delayed`, `delay_seconds` must agree with `source_delay_seconds` when declared.
- If `quote_kind=bar_close`, include `source_bar_time` (minute start), `quote_time_precision: "minute_bar_end"`, and descriptive `quote_basis`. Require `quote_at = source_bar_time + 60 seconds`, exactly aligned to a minute and no later than retrieval. `quote_at_semantics` should explicitly say interval end, not exact transaction time.
- For ordinary open equities the quote must lie inside the verified active regular interval, not an overnight trade or earlier session.
- Source freshness checks: BTC at most 5 minutes old; other intraday observations at most 25 minutes old at both retrieval and collection. These ceilings are conservative validation bounds, not promises that a provider is real-time. Declared delay remains explicit. Too-old quotes fail instead of receiving a newly generated timestamp.

Lunch for SSE/HSI additionally needs:

- `market_state: "break"`, `break_start_at`, `break_end_at` exactly matching the independently verified calendar.
- `market_schedule_source_url`: official SSE or HKEX hours URL.
- `break_schedule_evidence_file`, `break_schedule_evidence_sha256`: current-run official schedule evidence.
- The quote must be from the latest morning session, no more than 25 minutes before the break start and not after it beyond clock skew. Retrieval and collection must be within the same verified pause. The prior full-day close remains the denominator.

If a source only supplies time-of-day and you infer the date, retain `quote_date_inferred: true`, a specific `quote_date_inference`, and `quote_date_context_evidence_file`/`quote_date_context_evidence_sha256` supporting explicit same-day context. Do not represent an inferred date as directly printed beside the source time.

## Asset-specific invariants

### BTCUSD

Require `quote_kind=bar_close`, `source_type: "AggLast"`, minute fields above, `previous_at`, `previous_source_bar_time`, and preferably `rolling_interval_seconds: 86400`. The two minute interval ends must differ by exactly 86,400 seconds, and each end equals its start plus 60 seconds. A prior available minute, calendar-day open, or vendor day-change does not satisfy rolling 24 hours. No Coinbase/Paxos venue substitution is allowed.

### XAUUSD

During open trading require `quote_kind=bar_close`, `source_type: "MidPoint"`, and completed-minute fields. Use indicative midpoint, not a claimed exact transaction. Provide `baseline_evidence_file`/`baseline_evidence_sha256` for the separately retrieved completed source daily close and `previous_date` matching the source-session calendar. For IBKR this baseline query must use 69067924/SMART. An eligible closed-session fallback follows the completed observation contract and uses the preceding source daily close as denominator.

### SSE

On `public_web`, require `corroboration_evidence_file`, `corroboration_evidence_sha256`, and `corroboration_source_url`, from a separately accessed different-domain source retained in the manifest. Include `corroboration_previous_value` and `corroboration_previous_date` agreeing exactly with the independently verified prior completed close/date. Inspect both sources' identity and current/date context; do not claim precise simultaneous matching if their intraday observations have different times. If dated daily closes are used, verify the current dated close too. The machine checks the prior-close/date agreement, but source interpretation remains the agent's responsibility.

### BRENT

Require:

- `contract_id`: positive integer dynamically resolved this run.
- `contract_code`, `contract_month` (six-digit YYYYMM), `contract_expiry` (ISO local last-trading date), `contract_last_trade_at` (timezone-aware exchange final-trading cutoff).
- `contract_confirmed: true`, `front_month_verified: true`: backed by a freshly read ladder and official expiry rules.
- `contract_evidence_file`/`contract_evidence_sha256`: fresh ladder. IBKR ladder query must use underlying 30865593.
- `expiry_source_url`: official ICE URL, plus `expiry_evidence_file`/`expiry_evidence_sha256` retaining its actual rule/expiry evidence.
- `baseline_contract_id`: exactly equal to `contract_id`, and `baseline_evidence_file`/`baseline_evidence_sha256`. The IBKR baseline query must use that same selected contract/IPE.
- `provider_contract` for IBKR: same selected integer / IPE / FUT.
- Recommended audit fields: `contract_exchange`, `roll_rule`, `baseline_disclosure` stating that a source daily close is not asserted to be verified official settlement.

At the exact final-trading cutoff, the expiring contract is no longer eligible. Resolve the next delivery and obtain BOTH its numerator and denominator. `contract_expiry` must match the London date of the final cutoff; the cutoff must be after collection. The helper checks these bindings, not whether a manually asserted ladder interpretation is honest; inspect retained source content.

### US10Y

Require `yield_definition: "CMT"`, `quote_kind: "official_daily"`, `market_state: "official_daily"`, official Treasury `source_url`, actual publication dates and the publication calendar. `unit` is `%`. Do not convert the yield into a price or label it live. Internal `change_bp` is recomputed by the renderer.

## Calculation and presentation

The normalizer computes `change_pct = (value / previous_value - 1) × 100` with decimal arithmetic. Do not round inputs before computing. If a same-basis `provider_change_pct` is supplied, it must agree within 0.02 percentage points for source display rounding; omit a vendor percentage with a different definition instead of force-fitting it. US10Y also computes basis points `(value - previous_value) × 100`.

Only the requested simple market table is visible: concise asset name, value, change percentage, and overall collection time. Provenance, unit definitions, source timestamps, delay, calendars, CMT/bp, 24-hour basis, gold midpoint, Brent delivery month and roll/baseline details stay in internal JSON/evidence, not extra visible row footnotes. Missing values remain `暂无可信报价`; never retain an old number dressed as current. HTML is the primary report artifact; PDF is an optional rendering of the same validated HTML, not a different data collection route.

## Tests and limitations

```sh
python -m unittest discover -s tests -p 'test_quote_contract.py' -v
```

Tests generate explicitly synthetic fixtures at runtime and cover empty current initialization, immutable bindings, stale/all-missing hard failure, raw hashes, traversal, nine-row shape, identities, contracts, official current-year calendars, missing dates, holidays, early close, lunch state, exact BTC minute/24-hour alignment, and percentage disagreement. They test invariants; they do not establish current market access. No previous report snapshot, hardcoded quote date, user delivery details, credentials, or absolute source-host path is needed to run this package.
