# Independent Global Market Data Loading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让全球市场页面的六类数据独立并发加载、直连失败自动走代理，且任一分区失败不影响其他分区。

**Architecture:** 在现有 Vite 本地 API 中抽取六个分区加载器，并为每个分区提供独立缓存和 in-flight 去重。React 客户端同时请求六个分区并增量合并，完整 Dashboard 接口通过合并分区结果继续兼容。

**Tech Stack:** TypeScript、Vite middleware、React 18、Undici ProxyAgent

---

### Task 1: 统一外部请求回退

**Files:**
- Modify: `vite.config.ts`

**Steps:**
1. 为 JSON/HTML/CSV 请求统一复用 `fetchExternalText`。
2. 将 Yahoo、指数、Nasdaq 日历等核心源改为直连短探测后代理回退。
3. 运行 `npm run build`，预期 TypeScript 和 Vite 构建通过。

### Task 2: 抽取后端分区加载器

**Files:**
- Modify: `vite.config.ts`

**Steps:**
1. 抽取 `markets`、`macro`、`pmi`、`commodities`、`news`、`calendar` 加载函数。
2. 分区内部使用有界并发和 `Promise.allSettled`。
3. 为每个分区提供结构化空数据降级。

### Task 3: 独立缓存与 API 路由

**Files:**
- Modify: `vite.config.ts`

**Steps:**
1. 新增按 `region:section` 建键的缓存和 in-flight Map。
2. 缓存新鲜时直接返回；刷新失败时返回过期缓存。
3. 支持 `/api/global-macro-dashboard?region=global&section=<name>`。
4. 不带 `section` 时并发合并全部分区，保持旧响应结构。

### Task 4: 前端增量合并

**Files:**
- Modify: `src/components/GlobalMacroCommandCenter.tsx`

**Steps:**
1. 同时发出六个分区请求。
2. 每个请求完成后立即合并到现有 Dashboard state。
3. 仅在所有分区都失败时显示全局错误；刷新保留旧数据。

### Task 5: 验证

**Files:**
- Verify: `vite.config.ts`
- Verify: `src/components/GlobalMacroCommandCenter.tsx`

**Steps:**
1. 运行 `npm run build`，预期成功。
2. 并发请求六个 section，预期均返回 200 或各自独立降级。
3. 连续请求验证 45 秒缓存命中。
4. 请求完整接口，确认字段兼容且单分区失败不产生整页 500。

