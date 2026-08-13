# ADR-0005: Official-source macro release synchronization

## Status
Accepted

## Context
The macro dashboard refreshes its macro section every five minutes, caches the section for one minute, and sources the continuously visible CPI, PPI, and PCE series from FRED. This provides stable historical continuity, but FRED ingestion can trail the original CPI, PPI, Employment Situation, and PCE publication.

The dashboard needs release-grade freshness without continuously polling official agencies. The unregistered BLS API permits only 25 requests per day, so permanent 15-second polling is not viable.

## Decision
Use a two-layer source strategy:

- FRED is the stable primary delivery path for the continuously visible CPI, PPI, and PCE cards and their historical series.
- BLS news releases are the release-time authority for CPI, PPI, unemployment, and nonfarm payrolls.
- BEA's current Personal Income and Outlays release is the release-time authority for the PCE price index.
- Market-consensus data may enrich a card with an expected value, but it never supplies or overrides the actual value.

Maintain an official release schedule from BLS iCalendar and the BEA schedule page, with a checked-in 2026 fallback schedule. From two minutes before a release until 30 minutes after it, the client calls a dedicated release-sync endpoint every 15 seconds while the page is visible. The server fetches only the release family due at that moment, coalesces concurrent requests, and declares the release synchronized when the official statistical period matches the expected period. It then returns to the normal five-minute cadence immediately.

The server requests BLS or BEA directly only during the relevant release window. A successful official release patch can update the visible value immediately; a blocked, slow, or malformed official response cannot replace the last-good FRED value with an empty state. Cached last-good values remain visible during transient upstream failures.

## Consequences

### Positive
- Expected visible latency is at most one 15-second polling interval plus upstream response time.
- Release-time authority is BLS or BEA, while FRED keeps the normal dashboard path stable.
- Normal periods generate little official-source traffic.
- A dedicated endpoint avoids rebuilding unrelated market and macro cards during a release.
- Statistical-period checks prevent the monitor from stopping on a stale response.
- Direct BLS throttling or anti-automation responses do not make the cards display an unavailable state.

### Negative
- Official HTML wording changes can require parser maintenance.
- Anti-bot controls can add several seconds through the rendering fallback.
- The checked-in fallback schedule must be refreshed if both official schedule feeds are unavailable for an extended period.

### Neutral
- FRED remains useful for historical chart continuity but no longer determines the first displayed release value.

## Alternatives Considered

**Continuous BLS API polling**
- Rejected because the unregistered API allows only 25 requests per day.

**FRED-only polling**
- Rejected because FRED ingestion can trail the original official publication; it remains the stable display path but is supplemented during release windows.

**Direct BLS as the permanent display path**
- Rejected because throttling, anti-automation controls, and response latency can turn valid dashboard values into an unavailable state.

**A permanent WebSocket feed**
- Rejected because these indicators change only on scheduled publication dates; release-aware polling is simpler and has lower operational cost.

## References
- https://www.bls.gov/developers/api_faqs.htm
- https://www.bls.gov/schedule/news_release/bls.ics
- https://www.bls.gov/ppi/
- https://www.bls.gov/cpi/
- https://www.bls.gov/news.release/empsit.toc.htm
- https://www.bea.gov/news/schedule/full
- https://www.bea.gov/data/personal-consumption-expenditures-price-index
