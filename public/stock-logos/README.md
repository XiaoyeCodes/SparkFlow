# Stock Logos

This directory is committed with the repository so the heatmap can render logos
without runtime requests to third-party logo services.

Run `npm run logos:sync` while the SparkFlow development server is available to
refresh A-share, Hong Kong, and US files. Use `npm run logos:sync --
--market=china`, `npm run logos:sync -- --market=hongkong`, or `npm run
logos:sync -- --market=us` to refresh one market. Company names and logos are
trademarks of their respective owners and are used for market-symbol
identification.

Set `STOCK_LOGO_PROXY` when the TradingView scanner or logo CDN requires a proxy,
for example `http://127.0.0.1:7890`.
