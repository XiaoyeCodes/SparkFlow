# 加密行情与新闻来源恢复

## 今日复盘加密数据

- BTC、ETH、SOL 的现货报价与日线依次尝试 Binance API、Binance 公共行情域名、OKX；每个地址分别尝试直连和代理，不修改其他模块的网络路由。
- 按币种和资源合并并发请求。现货内存缓存 30 秒，日线缓存 60 秒；失败后保留有期限的磁盘快照，单项冷却 30 秒。现货原始报价时间最多容忍 15 分钟，日线快照最多保留一天；缓存不会改写源时间。
- 验证交易对、数值、原始时间、OHLC、UTC 日线连续性。拒绝缺口、短序列、无效价格与过期响应，不用模拟数字补齐。
- 后台保留原有两个普通补载任务通道，增加一个独立的现货和日线补载通道。只补缺失或无效字段，保留当天已成功生成的数据。
- BTC 价格曲线独立于支撑阻力位显示。没有确认的技术位显示为未确认，不再阻止价格曲线绘制。
- 页面缺失这些资源时每 15 秒读取后台缓存；正常复盘更新仍为 60 秒。补载不触发整份复盘或 AI 分析重新生成。

## 今日新闻

- 36 氪使用返回有效 RSS 的 `www.36kr.com/feed`。国家统计局从官方数据发布、数据解读栏目提取带原始日期的文章，不再依赖失效的 RSS 路径。
- 正常来源保留两分钟缓存；失败来源按 30 秒起步、最高五分钟的退避周期单独重试。后台每 30 秒检查一次到期来源，不重复抓取仍有效的正常来源。
- 每个来源保留最多 30 分钟的成功快照；过期数据不继续展示为有效缓存。恢复后清除错误及重试状态。文章的发布时间、来源和去重规则保持不变。
- 路由响应经过 RSS/Atom 或对应来源的结构校验，HTML 验证页不能当作成功响应；失败后可继续尝试另一条路由。有效的空订阅源允许返回零篇文章。
- 页面继续每 30 秒读取缓存，并在网络恢复或页面重新可见时更新。用户手动刷新仍可主动重新抓取来源。

## 验证

使用支持 TypeScript 类型擦除的 Node 运行：

```sh
npm run test:source-recovery
npm run test:daily-brief
node --no-warnings --experimental-strip-types scripts/verify-news-feed.mjs
node --no-warnings --experimental-strip-types scripts/verify-news-page-cache.mjs
npx playwright test --config playwright.ibkr.config.ts tests/ibkr/data-recovery.spec.ts tests/ibkr/global-macro-preload.spec.ts
npm run build
```

恢复测试覆盖主源失败、独立备用源、过期和重启缓存、并发去重、短历史修复、普通补载任务隔离、新闻失败后自动恢复和原始文章日期。浏览器测试模拟先失败后恢复，检查图表、侧栏行情、来源状态以及宏观数据并行加载。
