# ADR-0001: 全球市场数据采用分区并发加载

## Status
Accepted

## Context
全球市场页面原先通过一个聚合接口等待市场、宏观、PMI、商品、新闻和日历全部完成。任何未隔离的外部请求失败都会使整个接口返回 500，并阻塞所有区域首屏显示。外部源同时存在直连不稳定、代理可用性波动和不同更新频率。

## Decision
将 Dashboard 拆分为 `markets`、`macro`、`pmi`、`commodities`、`news`、`calendar` 六个 I/O 分区。前端并发请求并按完成顺序合并。每个后端分区使用独立的 45 秒缓存、in-flight 去重、错误边界和过期缓存回退。外部 HTTP 请求默认先直连，短超时失败后再走本地代理。保留不带 `section` 参数的完整接口用于兼容。

## Consequences

### Positive
- 单个外部源失败不再拖垮整页。
- 快速数据先显示，慢速 PMI/新闻稍后增量出现。
- 同一分区并发刷新只执行一次上游请求。
- 旧调用方仍可使用完整 Dashboard。

### Negative
- 浏览器每轮刷新产生六个本地请求。
- 分区数据的 `generatedAt` 可能存在数秒差异。
- 后端需要维护分区缓存和合并逻辑。

### Neutral
- Node.js 使用异步 I/O，而非 Worker Threads；本任务没有 CPU 密集计算。

## Alternatives Considered
- 单一接口内部 `Promise.allSettled`：只能隔离失败，不能让前端按区域渐进显示。
- SSE 流式响应：协议和状态管理复杂度高，不适合当前本地 Vite 服务。
- Worker Threads：网络 I/O 不需要线程隔离，增加序列化和生命周期成本。

