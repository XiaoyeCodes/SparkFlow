# ADR-0007: Bounded public-data preloading on a single host

## Status
Accepted for the user-requested preload branch.

## Context
Visitors should read already prepared public data rather than trigger repeated upstream work. The host is a low-end Windows Mini exposed through Cloudflare Tunnel. Public market dashboards coexist with private account, trading, model credentials, research and custom subscription APIs.

## Decision
Use an explicit resource allowlist, a memory cache with finite byte/entry budgets, per-key request coalescing, a two-job scheduler and versioned per-key disk snapshots under `.sparkflow/public-data-cache`. Prewarm only common dashboards; refresh other registered resources while recently used. Reads never force a refresh storm. Validity deadlines outrank caching TTLs. Expired values are not served; failed refreshes retain last-good values only inside a documented stale window.

Browser components use an explicit public fetch helper, with short memory retention across route unmounts and independent abort signals. No global fetch interception, no shared personalized data, no blanket Cloudflare caching. The UI distinguishes last-good stale cache from verified-fresh cache, and source dates stay intact.

## Alternatives
- Browser-only caching: cheap but does not keep the server warm without visitors and repeats work across visitors.
- Redis/worker service: useful for multiple servers, but unnecessary installation and operational cost on a single Mini.
- Cache every GET or every region: rejected because it risks private data exposure, unbounded keys and expensive startup fan-out.

## Consequences
- Warm reads avoid upstream latency; cold first installation still needs actual downloads.
- Memory and scheduler limits bound cache overhead, not the internal fan-out of an individual legacy loader.
- File snapshots are recoverable acceleration, not the authoritative store. Invalid, oversized, expired or wrong-version files are ignored.
- Server downtime/power loss, upstream access restrictions and client rendering performance remain outside this feature.
- Cache age is not market quote age: existing observation timestamps and validity rules remain authoritative.

## References
- React external-store subscription: https://react.dev/reference/react/useSyncExternalStore
- Node filesystem write ordering: https://nodejs.org/api/fs.html
