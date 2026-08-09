# Core Index Pulse Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a compact four-index pulse above the crypto market, showing the daily change for Nasdaq, S&P 500, Shanghai Composite, and the Philadelphia Semiconductor Index.

**Architecture:** Extend the existing `markets` dashboard section with a fixed-order `coreIndices` payload. Reuse the already-fetched Nasdaq, S&P 500, and Shanghai quotes, fetch only `^SOX` separately, and always return four entries with unavailable fallbacks. Render the payload as a responsive 2×2 card grid in the macro pulse sidebar.

**Tech Stack:** React 18, TypeScript, Vite middleware, CSS.

---

### Task 1: Extend the market dashboard payload

**Files:**
- Modify: `vite.config.ts`

1. Request the Philadelphia Semiconductor Index alongside the existing independent market requests.
2. Build a fixed-order `coreIndices` array, reusing the existing market quote results for the first three indices.
3. Preserve all four entries with a `status: unavailable` fallback when a provider request fails.

### Task 2: Render the index pulse

**Files:**
- Modify: `src/components/GlobalMacroCommandCenter.tsx`

1. Add the index quote type and dashboard field.
2. Add an accessible index card with name, ticker, 24-hour percentage change, and sparkline.
3. Insert the four-card section immediately above the crypto market section.

### Task 3: Style and verify

**Files:**
- Modify: `src/components/GlobalMacroCommandCenter.css`

1. Add compact 2×2 grid styling with existing terminal colors and China-market red-up/green-down semantics.
2. Add hover and keyboard focus states and prevent mobile overflow.
3. Run the production build, inspect the API payload, and visually verify the rendered section.
