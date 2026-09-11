# ADR 0007: Isolate paper-order failures instead of freezing the account

- Status: Accepted
- Date: 2026-09-11

## Context

The paper-trading workbench receives asynchronous and sometimes duplicated IBKR callbacks. An order rejection, cancellation notice, late commission, or temporarily unresolved order can arrive before or after the corresponding open-order and account snapshots. Treating every such callback as an account-integrity failure prevents unrelated manual paper orders and makes normal repeated order/cancel workflows appear to freeze the account.

The workbench must still prevent overspending, short selling, duplicate transmission, and use of contradictory broker evidence.

## Decision

1. Broker order errors, ordinary rejections, cancellation notices, late fees, and unresolved order state are order-local. The affected order keeps its worst-case cash or share reservation and is reconciled automatically. Other explicitly confirmed manual paper orders may proceed against the remaining unreserved cash or shares.
2. Connectivity events gate new wire transmissions only until the SDK reports recovery. They do not create durable account halts.
3. Only contradictory durable evidence—such as conflicting executions, identities, or terminal states—creates an account-integrity halt. A fresh full broker proof is required to recover it.
4. Manual paper orders are not subject to strategy frequency, daily-count, price-deviation, concentration, or daily-loss policy limits. They remain subject to explicit confirmation, fresh broker context, settled/available cash, owned shares, whole-share increments, no leverage, and durable idempotency.
5. Pending and unresolved orders remain fully reserved. This is what makes independent consecutive orders safe without a global lock.
6. SMART orders opt into eligible pre-market and after-hours trading. Explicit overnight orders use the IBKR `OVERNIGHT` exchange route, retain the listing exchange as `primaryExchange`, and are limited to DAY limit orders.

## Consequences

- A rejected, cancelled, or still-reconciling order no longer freezes unrelated manual paper trading.
- Users can submit and cancel repeatedly, subject to actual remaining cash/shares and broker connectivity.
- Capital may remain conservatively unavailable until IBKR completes reconciliation, but the rest of the account stays usable.
- Genuine ledger contradictions still stop new orders because continuing could duplicate spending or bind fills to the wrong order.
- Overnight availability remains dependent on IBKR permissions and symbol eligibility; an order-level broker rejection is displayed without freezing the account.

## Alternatives considered

- Release reservations immediately on an error callback: rejected because error callbacks do not contain authoritative fill counters and can race with executions.
- Ignore all broker inconsistencies in paper mode: rejected because paper accounts still represent real broker state and duplicate or misbound orders would invalidate the simulator.
- Keep the global unresolved-order lock: rejected because full worst-case reservations already provide the required account-level financial isolation.
