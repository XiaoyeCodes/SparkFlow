# 新闻时效与重要性修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让全球市场滚动新闻仅显示发布时间可验证的当日内容，并减少观点类标题的重要性误判。

**Architecture:** 全球宏观新闻改用发布方 RSS 的原始发布时间，国内 RSS 直连失败时自动走本地代理。Google News 聚合时间不再作为实时发布时间。评分层增加“正式发布”和“观点解读”区分，前端对无效时间显示待核验而不是“刚刚”。

**Tech Stack:** Vite dev middleware, TypeScript, React

---

### Task 1: 修复新闻来源与时间

**Files:**
- Modify: `vite.config.ts`

1. 将发布方 RSS 请求改为直连失败后代理回退。
2. 全球实时新闻只使用发布方 RSS 的 `pubDate/published/updated`。
3. 保留当日、有效、非未来时间的数据。
4. 请求接口，确认返回链接不是 Google News 聚合链接且发布时间可解析。

### Task 2: 修复重要性判定

**Files:**
- Modify: `vite.config.ts`

1. 扩充正式发布类关键词。
2. 将观点、预测、解读类内容限制在中等重要性。
3. 运行接口验证 importance 分布与标题语义一致。

### Task 3: 修复前端时间兜底

**Files:**
- Modify: `src/components/GlobalMacroCommandCenter.tsx`

1. 无时间、非法时间或明显未来时间显示“时间待核验”。
2. 构建项目并检查差异格式。

