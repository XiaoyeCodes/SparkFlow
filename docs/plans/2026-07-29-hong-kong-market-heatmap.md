# Hong Kong Market Heatmap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the stock market view into A-share, Hong Kong, US, and crypto modes, with a dedicated Hong Kong heatmap matching the A-share heatmap.

**Architecture:** Add `hongkong` to the shared market mode model and move Hong Kong indices out of the A-share mode. Reuse one configurable regional heatmap renderer for A-share and Hong Kong data, while exposing separate API endpoints and separate cache lifecycles.

**Tech Stack:** React 18, TypeScript, D3 hierarchy treemap, Vite middleware, Eastmoney quote APIs, Playwright visual checks.

---

### Task 1: Add the Hong Kong heatmap data endpoint

**Files:**
- Modify: `vite.config.ts`

**Step 1: Extend the market model**

Add `hongkong` to the index snapshot market union and assign Hang Seng indices to it.

**Step 2: Add the Hong Kong quote loader**

Fetch Hong Kong main-board equities from Eastmoney market `116`, sorted by market cap. Remove RMB-counter duplicates, validate price/change/market-cap fields, and return the same response shape as the A-share endpoint.

**Step 3: Add independent caching**

Create a Hong Kong cache and in-flight request guard with the same eight-second policy as the A-share heatmap.

**Step 4: Expose the endpoint**

Serve the payload at `GET /api/hong-kong-market-heatmap`.

**Step 5: Verify the endpoint**

Run the Vite server and request the endpoint. Expect at least one stock, five-digit Hong Kong codes, market-cap values, industries, and source URLs.

### Task 2: Reuse the A-share heatmap renderer

**Files:**
- Modify: `src/components/ChinaMarketHeatmap.tsx`

**Step 1: Introduce regional heatmap configuration**

Parameterize endpoint, market label, search portal IDs, default coverage, loading/error text, logo path, and industry display priority.

**Step 2: Preserve the A-share wrapper**

Keep `ChinaMarketHeatmap` as a wrapper using the existing A-share configuration so current behavior does not regress.

**Step 3: Export the Hong Kong wrapper**

Add `HongKongMarketHeatmap` with Hong Kong labels and `/api/hong-kong-market-heatmap`.

**Step 4: Verify shared interactions**

Confirm search, hover details, industry zoom, wheel zoom, dragging, fullscreen, refresh, and external quote links work in both wrappers.

### Task 3: Split the market page into four modes

**Files:**
- Modify: `src/routes/Market.tsx`

**Step 1: Extend page state**

Add `hongkong` to `MarketChartMode`, research state initialization, saved summaries, and export naming.

**Step 2: Update market metadata**

Rename the current China mode to `A股`, add a dedicated `港股` mode, and give each mode accurate heatmap descriptions and external links.

**Step 3: Render the correct heatmap**

Render `ChinaMarketHeatmap` for A-share, `HongKongMarketHeatmap` for Hong Kong, and TradingView heatmaps for US and crypto.

**Step 4: Separate index and research context**

Display mainland indices under A-share and Hang Seng indices under Hong Kong. Update research prompts and cross-market flow notices so A-share data is not presented as Hong Kong flow data.

### Task 4: Build and visually verify

**Files:**
- Verify: `src/routes/Market.tsx`
- Verify: `src/components/ChinaMarketHeatmap.tsx`
- Verify: `vite.config.ts`

**Step 1: Run type and production build**

Run `npm run build`.

Expected: TypeScript and Vite complete successfully.

**Step 2: Capture browser screenshots**

Capture the A-share and Hong Kong modes after data loads.

Expected: Four market tabs are visible, Hong Kong has its own indices and heatmap, and the heatmap layout matches A-share.

**Step 3: Exercise Hong Kong interactions**

Search for `00700` or `腾讯控股`, open an industry, zoom, return to the full map, and refresh.

Expected: Each interaction succeeds without console or layout errors.
