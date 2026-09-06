# IBKR terminal backtest reuse decision

Status: engineering decision, 2026-09-05. This does not validate a user strategy.

## Reuse

- Keep the existing loader registry and local loader interfaces. They already separate data acquisition from simulation and can supply versioned input files to the terminal worker.
- Keep the existing `Runner(timeout=300)` subprocess boundary and run-card hashing concepts. The terminal worker must add lower configurable limits, cancellation, and a durable job state before exposing them in the UI.
- Keep the next-bar alignment concept in `backtest/engines/base.py`: `_align` shifts a signal by one bar before execution.
- Reuse metric names only after recalculating them from terminal output. Existing report files are not accepted as account or terminal facts without their input/version hashes.

## Do not use as the terminal gold-standard ledger

- `BaseEngine` stores cash, prices, sizes, fees, slippage, PnL, and metrics as binary floats. The terminal order ledger and reproducible goldens require decimal strings and fixed precision.
- The engine executes ordinary changes at next-bar open, but forces the last position closed from the close series without applying the same slippage path. That prevents one uniform manual calculation.
- The base equity path has no explicit split/dividend event ledger, and missing corporate-action data cannot be distinguished from an event-free period.
- User-provided `signal_engine.py` receives the complete data frame. A one-bar shift prevents same-bar execution but does not prove the signal itself avoided future rows.
- The shadow-account wrapper may surface combined metrics as each market's metrics. That lossy projection is unsuitable for per-account evidence.

## Terminal boundary

`ibkr_terminal.strategy` stores immutable, source-labelled declarative versions. `ibkr_terminal.backtests` will use a decimal event ledger and causal inputs for gold tests, while adapters may call existing loaders and the subprocess runner. Fixture strategies and fixture datasets remain disabled in production stores unless an explicit engineering instance enables them.
