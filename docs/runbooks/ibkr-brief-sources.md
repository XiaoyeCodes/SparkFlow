# IBKR 简报公开数据采集

账户持仓、现金和盈亏仍来自 IBKR。下列接口只接收公开证券代码或公开页面地址。

## 来源与降级

- 公司资料：TradingView 美国市场扫描接口一次查询全部持仓，逐行校验代码、交易所、币种和证券类型。缺失的标的单独重试，Yahoo quoteSummary 作为备用。ETF 不套用普通公司的估值字段。
- 近期新闻：Apple、NVIDIA、AMD、Lilly 的官方 RSS/Atom，以及 Yahoo Finance 新闻 RSS。没有可读近期原文时，再使用现有搜索服务补充。订阅摘要、搜索摘要和搜索引擎跳转页不作为新闻原文；Atom updated 不作为发布日期。
- 日历：优先读取公司的官方投资者关系页面。页面读到但没有核实近期事件时记为 `calendarChecked`，不等于确认未来没有事件，也不计作 `calendar` 事件覆盖。
- 财报：SEC EDGAR，当前简报的结构化采集范围仍为重点持仓损益表。
- 历史行情：Yahoo query1/query2，分别限时；公司资料中的价格不能替代历史价格序列。
- 宏观：BLS API 失败后读取圣路易斯联储 FRED 分发的相应 BLS 序列，保留来源、观察期、单位与修订口径，不把观察月份当成发布日期。FRED CSV 优先直连、失败再使用环境代理；使用 HTTP 客户端默认请求头。

## 时间与真实性边界

整轮最多六分钟、三个并发任务、每个工具请求最多十六秒。公司资料合并请求；所有持仓的新闻扫描先于逐个日历扫描，避免少数慢日历让后续持仓完全没有新闻覆盖。公开数据工具不再为每个请求加载模型 SDK。

已成功读取的公司资料与原文在 `.sparkflow/ibkr-public-cache` 保留十分钟缓存，原抓取时间与发布日期不变；不缓存失败响应。网络短暂抖动时无需重复访问刚成功的来源。缓存不代表实时价格或新的新闻发布日期。

旧新闻或缺日期的文章可以保留为有明确限制的背景，但不计入近期新闻覆盖，采集器继续尝试下一篇。已读资料的价格观察时点未知时保持未知，不能用抓取时间补造。未获取的分析师一致预期、历史估值分位和 ETF 穿透权重属于功能范围限制，在界面与本期抓取错误分开显示。

## 回归验证

```powershell
npm run test:ibkr:workbench
& services/vibe-trading/.venv/Scripts/python.exe tests/workbench/brief-public-reader.test.py
& services/vibe-trading/.venv/Scripts/python.exe tests/workbench/brief-sources.test.py
& services/vibe-trading/.venv/Scripts/python.exe tests/workbench/brief-cache.test.py
npx tsc -b --pretty false
npx playwright test --config playwright.ibkr.config.ts daily-brief.spec.ts
```

真实数据验证应同时检查 `coverage`、`evidence` 与 `researchGaps`。生成任务显示成功，不代表全部数据已覆盖。重新生成完整账户简报还需要有效 IBKR 连接、最新账户快照及该模型已有的账户分析授权。
