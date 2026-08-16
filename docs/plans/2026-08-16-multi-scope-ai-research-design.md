# Multi-Scope AI Research Implementation Plan

> **For implementation:** execute this plan task-by-task in the current `codex/global-macro-dashboard-v2` branch and preserve the existing resumable analysis behavior.

**Goal:** Expand the macro AI entry into global, country-market, and single-equity research modes, with resumable history and Goldman-style equity Markdown reports.

**Architecture:** Keep one durable browser-side task model and one Vibe-Trading research transport. Select the prompt builder by task scope. Port the external Coze project's research SOP and Markdown report contract into SparkFlow instead of creating a runtime dependency on its private Coze workload credentials.

**Tech Stack:** React 18, TypeScript, Framer Motion, React Markdown, Vite middleware, Vibe-Trading research API.

---

## Requirements

- Clicking the Sparkles icon expands/collapses a mode tray below the main action.
- Modes: global market, one country/region market, and one listed company.
- Country mode accepts a country/region name, instructs the LLM to obtain missing authoritative external data, and produces an institutional market report.
- Equity mode accepts a ticker or company name and ports the supplied project's realtime-first research SOP and report structure.
- Equity Markdown is rendered as a navy, white, and restrained gold research document inspired by the supplied PDF, without claiming affiliation with Goldman Sachs.
- Running analyses remain visible in history and can be resumed after route changes.
- History rows identify scope and query.
- Inputs are validated and failures are human-readable.

## ADR-001: Port the research contract, not the Coze runtime

**Context:** The supplied Python project uses Coze workload-identity credentials and a separate FastAPI/LangGraph runtime. Its system prompt already generates Markdown before a PDF converter styles it.

**Decision:** Reuse its research sequence, data-quality rules, and Markdown information architecture inside SparkFlow prompt builders, then run them through the already configured Vibe-Trading engine.

**Alternatives considered:**

1. Start the supplied service from Vite. Rejected because local and deployed environments would require private Coze credentials and another long-running process.
2. Parse the generated PDF back into Markdown. Rejected because it loses semantic structure and makes PDF layout a brittle runtime dependency.
3. Port the prompt contract and render Markdown directly. Chosen because it preserves the useful research logic, uses one credential path, and supports existing background-task recovery.

**Failure handling:** If external verification is unavailable, the report must mark data as unavailable rather than fabricate values. An analysis failure affects only its own task.

## Task 1: Add scoped prompt builders

**Files:**

- Create `src/lib/marketResearchPrompts.ts`
- Modify `src/lib/macroAiPrompt.ts`

**Steps:**

1. Define `AiResearchScope = 'global' | 'country' | 'equity'`.
2. Add country-market instructions covering cycle, policy, valuation, liquidity, currency, sectors, foreign flows, scenarios, and authoritative sources.
3. Add equity instructions porting realtime-first identity resolution, company/industry/financial/valuation/catalyst/risk/peer-analysis SOP.
4. Reuse a common 4,900-character prompt budget and preserve all required sections when compacting terminal context.
5. Add deterministic prompt verification for scope, query, source rules, and length.

## Task 2: Extend durable analysis records

**Files:**

- Modify `src/components/MacroAiAnalyst.tsx`

**Steps:**

1. Add `scope` and `query` to persisted records with legacy defaults.
2. Preserve scope/query when a running record becomes completed.
3. Display scope badges and the requested country/company in history.
4. Restore the correct report appearance when opening or resuming a task.

## Task 3: Build the mode tray and inputs

**Files:**

- Modify `src/components/MacroAiAnalyst.tsx`
- Modify `src/components/MacroAiAnalyst.css`

**Steps:**

1. Make the Sparkles area an independent accessible disclosure button.
2. Animate a three-option research tray below the CTA.
3. Show no input for global, a country input for country mode, and ticker/company input for equity mode.
4. Keep the main RUN surface as the execution action and update its copy for the selected scope.
5. Validate input and focus the relevant field when modes change.

## Task 4: Add institutional equity-report rendering

**Files:**

- Modify `src/components/MacroAiAnalyst.tsx`
- Modify `src/components/MacroAiAnalyst.css`

**Steps:**

1. Attach a scope class to the report view.
2. Render equity reports on a light research-paper surface.
3. Use navy section bands, a thin gold rule, compact metadata, restrained tables, and print-like typography matching the reference PDF's hierarchy.
4. Keep global and country reports in the existing dark terminal aesthetic.
5. Add a neutral “AI Equity Research” masthead and a visible generated-research disclaimer.

## Task 5: Verify end-to-end behavior

**Commands and evidence:**

1. Run prompt checks with `node --experimental-strip-types` and require every prompt to be under 4,900 characters.
2. Run `npm run build`; expected exit code 0.
3. Run a real country request and confirm the Vibe API accepts an attempt.
4. Run a real equity request using a ticker/company input and confirm a completed Markdown report.
5. Browser-test: expand tray, switch all modes, validate inputs, start a task, change route, return, resume from history, and open the completed report.
6. Run `git diff --check`; expected no whitespace errors.
