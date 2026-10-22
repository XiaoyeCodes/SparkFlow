# Fresh market inputs: agent tools, not a universal quote API

The Python helper is an **offline agent-tool bridge**, not an autonomous data collector. It never signs in, creates an account, purchases a data entitlement, calls an undocumented endpoint, or provides credentials. This package does not include a free universal nine-asset API. The executing agent must use tools actually available in its host, retrieve fresh sources on every run, and retain their responses. If a route is unavailable, that asset must be unavailable. Do not turn an instrument-definition page into fictitious quote evidence.

## Discover the actual capabilities

1. Inspect the current host's available tools and schemas for the existing, connected Interactive Brokers read-only connector. Relevant operations are `get_price_history`, `get_price_snapshot`, instrument search/contract details, and `search_futures`. Do not assume installation implies a working connection: attempt a relevant read.
2. If the host provides a tool metadata registry such as `ALL_TOOLS`, filter names/descriptions for `interactive_brokers`, `ibkr`, `price history`, `price snapshot`, and `search futures`. With the orchestration interface used by this package's source research, this inspection looks like:

   ```javascript
   text(ALL_TOOLS.filter(t => /interactive_brokers|ibkr/i.test(t.name + ' ' + t.description)));
   ```

   Read the selected schema before invoking it. Tools exposed to the orchestrator use normalized JavaScript identifiers. Names are host-specific; discover them, do not manufacture a callable name. Preserve the exact callable name and arguments in the run manifest. A host without this registry should use its own capability-discovery interface. A tool name is not an HTTP URL.
3. The source environment exposed names ending in `interactive_brokers_ibkr_get_price_history`, `interactive_brokers_ibkr_get_price_snapshot`, and `interactive_brokers_ibkr_search_futures`, under its Interactive Brokers connector namespace. These are operation identification hints, not a promise they exist in another host.
4. If the connector is absent, denied, disconnected, or lacks an entitlement, inspect current public webpages through an available read-only web/browser tool. Do not claim a missing integration is connected, install one silently, ask the user to register with a broker, or claim a free real-time data entitlement. Respect denied access. Use only a newly accessed, visibly verifiable page that satisfies the SAME instrument/baseline contract. Otherwise mark the row unavailable with the exact limitation.
5. Preserve the unmodified tool response. If a response has `structuredContent` and text JSON, retain both in the raw evidence file; parse the representation actually returned. Record timestamps around the call using a trustworthy UTC clock. An observed batch completion time is an upper bound, not an exact server timestamp. Never use cache expiry, retrieval time, or article publication time as a trade time.

## The nine immutable benchmark identities

| ID | Contract `instrument_id` and definition | Connected IBKR seed, subject to fresh identity check | Public reference / fallback policy |
|---|---|---|---|
| COMP | `NASDAQ:COMP:PRICE_INDEX`: Nasdaq Composite price index | 18342287 / NASDAQ / IND | [Nasdaq index definition](https://indexes.nasdaqomx.com/Index/Overview/comp). A newly accessed quote/history page must explicitly identify the Composite and dated regular-session observations; never substitute Nasdaq-100, QQQ, or futures. |
| SPX | `SPDJI:SPX:PRICE_INDEX`: S&P 500 price index | 416904 / CBOE / IND | [S&P index definition](https://www.spglobal.com/spdji/en/indices/equity/sp-500/). An accessible definition/factsheet alone is not a current quote. Never substitute SPY, total-return index, or futures. |
| MAGS | `CBOE_BZX:MAGS:ETF`: US-listed Roundhill Magnificent Seven ETF, market price | 624756922 / SMART / STK | [Issuer](https://www.roundhillinvestments.com/etf/mags/). A webpage must distinguish US listing, market price, regular close, and NAV; issuer NAV is not the requested quote. Never use a same-ticker overseas product or overnight trade. |
| SSE | `SSE:000001:PRICE_INDEX`: Shanghai Composite price index | No working IBKR index contract was established | [Investing current page](https://cn.investing.com/indices/shanghai-composite), [dated history](https://cn.investing.com/indices/shanghai-composite-historical-data), and separately accessed [CFI](https://quote.cfi.cn/quote.aspx?client=phone&stockid=714). These are explicit secondary sources, not official SSE data. The cross-check must agree on benchmark identity, applicable date context, and prior regular close/date. Current prices need agree only when the sources identify the same timestamp; distinct intraday timestamps can legitimately carry different current values. A Shenzhen-listed equity called 000001 is not this index. |
| HSI | `HSI:HSI:PRICE_INDEX`: Hang Seng price index | 1328298 / HKFE / IND | [Index provider](https://www.hsi.com.hk/en-hk/indexes/all-indexes/index-details/?seriesCode=hsi). Use the cash price index, not futures, an ETF, or total return. The connector exchange label HKFE does not change the benchmark into a future. |
| BTCUSD | `PAXOS:BTCUSD:SPOT`: Paxos Bitcoin/USD spot, completed AggLast one-minute close | 479624278 / PAXOS / CRYPTO | [Contract definition](https://www.interactivebrokers.com/docs/tws-api/contracts/cryptocurrency). No proven no-account public webpage route for this exact venue plus exact 24-hour matched minute is supplied. A Coinbase/Binance price silently changes the benchmark. Mark unavailable unless the exact contract can be freshly verified. |
| XAUUSD | `LONDON:XAUUSD:SPOT_MIDPOINT`: London spot gold, USD per troy ounce; indicative MidPoint one-minute close | 69067924 / SMART / CMDTY | [IBKR spot metal definition](https://www.interactivebrokers.com/campus/trading-lessons/trading-spot-gold-and-silver-using-ibkrs-tws/?retakeFinal=1). SMART is the demonstrated route, not IBCMDTY. No proven equivalent free public minute-MidPoint route is supplied. Do not substitute COMEX futures, USGOLD, a gold ETF, or LBMA auction. |
| BRENT | `ICE:BRENT:FRONT_FUTURE`: ICE Futures Europe earliest nonexpired Brent delivery contract | Resolve every run from underlying 30865593; FUT / IPE | [ICE product specification](https://www.ice.com/products/219/Brent-Crude-Futures). A current public quote page is eligible only with explicit delivery month, quote time/delay, prior close from the same contract, and official expiry verification. Never use Dated Brent spot, an undated continuous-series value, or a fixed contract copied from a sample. |
| US10Y | `UST:CMT:10Y`: official US Treasury nominal par constant-maturity 10-year yield | Use official Treasury HTML, not a broker proxy | [Daily Treasury Par Yield Curve Rates](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve). Read named `Date` and `10 Yr` columns. It is a daily CMT observation, not a live note yield, TNX, or a real yield. |

The IDs in the IBKR column are instrument lookup seeds, not private account IDs. Check the returned definition on each run. If a seed changes or resolves ambiguously, do not force it through validation; investigate and update this contract deliberately. A newly accessed public page is eligible only if its returned content supplies the required fields. This document does not assert that every linked page is an extractable current-price feed.

## Exact connector argument templates

Use these only with the matching discovered operation schema. All are read-only.

### Regular close and intraday equity/index route

Closed COMP example:

```json
{"contract_id":18342287,"exchange":"NASDAQ","security_type":"IND","outside_rth":false,"period":"ONE_WEEK","step":"ONE_DAY"}
```

Replace the triple with SPX 416904/CBOE/IND, MAGS 624756922/SMART/STK, or HSI 1328298/HKFE/IND. Expand the period if holidays leave fewer than two completed observations. Select the calendar-verified completed session, NOT simply the final daily bar. A daily bar for the currently open session is partial.

Open or lunch-pause quote template:

```json
{"contract_id":1328298,"exchange":"HKFE","market_data_names":["last","change","prior_close"]}
```

Use the matching contract for each asset. Source `last` needs an actual quote timestamp and declared/unknown delay metadata. If prior-close is empty, fetch regular-session daily history for the denominator. Never parse an empty object as zero. During a verified lunch pause use the latest valid morning quote and previous completed daily close; do not call the morning value a full-day close. If needed, a completed minute history can corroborate the morning quote:

```json
{"contract_id":1328298,"exchange":"HKFE","security_type":"IND","outside_rth":false,"period":"ONE_DAY","step":"ONE_MIN"}
```

### BTC and spot gold

```json
{"contract_id":479624278,"exchange":"PAXOS","security_type":"CRYPTO","outside_rth":true,"period":"TWO_DAYS","step":"ONE_MIN"}
```

For gold replace with 69067924/SMART/CMDTY, then separately fetch:

```json
{"contract_id":69067924,"exchange":"SMART","security_type":"CMDTY","outside_rth":true,"period":"ONE_WEEK","step":"ONE_DAY"}
```

Check the returned series type. BTC uses AggLast and exact same minute 86,400 seconds earlier. Gold uses indicative MidPoint and preceding completed source daily close. Drop an incomplete minute; `quote_at = source_bar_time + 60 seconds`. Gold's daily-bar timestamp is not necessarily the close timestamp. Verify its source-session definition against the broker's current official trading hours. In a verified venue closure, gold may use latest completed source session close with the preceding source daily close, with `quote_kind=session_close` and all fallback metadata internal.

### Brent front contract and roll

```json
{"underlying_contract_id":30865593}
```

Read the returned ladder. Verify delivery month, actual contract ID, exchange, official last trading date and intraday final cutoff. Select the earliest delivery still trading at the collection cutoff. There is deliberately no hardcoded futures contract ID in the production request.

Then populate the selected integer contract ID in the available snapshot/history tool arguments:

```json
{"contract_id":"<selected integer>","exchange":"IPE","market_data_names":["last","change","prior_close"]}
```

```json
{"contract_id":"<same selected integer>","exchange":"IPE","security_type":"FUT","outside_rth":true,"period":"ONE_WEEK","step":"ONE_DAY"}
```

The angle-bracket strings are explanatory placeholders, not runnable values. The actual argument must be an integer. Obtain current and baseline data from this SAME delivery contract, including roll day. A daily source close is not automatically verified official settlement. Keep `baseline=provider_daily_close`; only use the specified contract semantics. The observed delay in one source environment was 900 seconds, not a guarantee for future runs. Read each returned delay anew.

At a session reopening, a delayed snapshot may still show the previous session. Never broadly waive freshness. A `session_close` fallback is eligible only when the independently verified market is closed or the current opening is still inside its explicitly declared delay window. Keep latest completed date, same-contract preceding date, and the non-live fallback description internally.

### SSE webpage extraction

Access the current index/history page and CFI separately in THIS run. An undated time-of-day must be bound to explicit same-day page context, with `quote_date_inferred=true` and an explanation retained. Require timestamp, previous regular close, acceptable age, and concordant benchmark/date/prior-close evidence. Compare current values only at matching source timestamps; do not reject legitimately different intraday observations solely because their prices differ. For completed daily closes, corroborate the explicit completed-date close itself as well. Preserve both raw responses and both hashes. If the source declares delay but not its duration, disclose that internally. During lunch the renderer permits `declared_unspecified` with a real source delay disclosure; it never interprets that as zero delay. If the cross-check fails or an article merely quotes an unspecified prior value, mark SSE unavailable.

### Treasury HTML route

Derive `YYYYMM` from the actual run's America/New_York date and request:

`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve&field_tdr_date_value_month=YYYYMM`

Fetch the previous month as necessary to obtain two published observations. Parse the named `Date` and `10 Yr` headers, not a positional column index. Independently verify holiday/publication context using `calendar-policy.md`. Preserve dates as dates; do not fabricate a 16:00 quote time. Percent change remains `(current / previous - 1) × 100`; the internal basis-point change is `(current - previous) × 100` when yields are percentage values. No operational XML/CSV endpoint is promised by this package.

## Fallback and failure behavior

- A public webpage fallback is an actual fresh read, not a guessed API. Verify instrument, units, timestamp/date, delay, same-definition denominator and relevant calendar; retain raw evidence. If any required fact is absent, show `暂无可信报价`.
- Definitions/reference links do not establish current market access, licensing, entitlement, or redistribution rights. Do not infer real-time from a marketing label. Do not imply simultaneous real-time prices across all markets.
- Read access alone authorizes no trades, holdings reads, signups, subscriptions, sending, or scheduling. This workflow only produces local report artifacts.
- `ready_degraded` is an explicitly partial report. All nine unavailable is a hard technical failure, not a successful current market section. Never renew old timestamps, embed a known-date production fixture, or reuse prior evidence as though called again.
