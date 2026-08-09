# Global Macro Pulse Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the redundant global exchange watchlist with a compact Global Macro Pulse that explains the current cross-asset regime, regional breadth, leading news drivers, and next major event at a glance.

**Architecture:** Reuse the existing `/api/global-macro-dashboard` response and add two missing cross-asset signals (DXY and US 10-year yield). Derive the pulse deterministically in a dedicated React component so the UI never invents causal explanations; it summarizes observed price, breadth, volatility, and headline data. Keep the existing dashboard shell and responsive behavior.

**Tech Stack:** React 18, TypeScript, Vite middleware, CSS.

---

### Task 1: Supply the missing cross-asset signals

**Files:**
- Modify: `vite.config.ts`

**Step 1:** Add DXY and US 10-year yield tasks to the existing macro dashboard request.

**Step 2:** Preserve partial-failure behavior with explicit unavailable fallbacks.

**Step 3:** Run `npm run build` and confirm TypeScript accepts the response shape.

### Task 2: Build the Global Macro Pulse panel

**Files:**
- Modify: `src/components/GlobalMacroCommandCenter.tsx`

**Step 1:** Add deterministic helpers for regime, growth, inflation, liquidity, regional breadth, and signal formatting.

**Step 2:** Add an accessible `MacroPulsePanel` with compact session status, current regime, four key changes, regional pulse, three linked news drivers, and the next-event countdown.

**Step 3:** Replace the existing watchlist/calendar/risk markup with the new panel.

**Step 4:** Run `npm run build`; expected result is a successful TypeScript and Vite production build.

### Task 3: Style and visually verify the panel

**Files:**
- Modify: `src/components/GlobalMacroCommandCenter.css`

**Step 1:** Implement the dark terminal-style hierarchy, non-red/green semantic accents, compact bars, focus states, loading/empty states, and reduced-motion behavior.

**Step 2:** Verify desktop and mobile layout with the existing local Vite app and capture a screenshot.

**Step 3:** Fix any overflow, truncation, contrast, or alignment issues found in the screenshot, then rerun the production build.
