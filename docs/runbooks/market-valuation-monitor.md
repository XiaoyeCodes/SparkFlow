# 大盘估值监控的数据来源

`server/ibkrValuationData.ts` 提供 `loadValuationInputs({ force?: boolean })`。每个序列都带来源、原始公布时间、当前值、历史记录和状态。前端只展示这些真实来源的结果，联网失败不会生成示例数据。

面板入口在固定侧边栏的「AI 分析」下面。它通过现有 SparkFlow 本地 Vite 开发或预览服务访问只读接口，不需要新增 API key。单文件 HTML 可独立保留样式、交互及导出的快照；重新拉取数据仍需要本机服务。

| GET 接口 | 返回内容 |
| --- | --- |
| `/api/ibkr-valuation?years=5` | 指定回看窗口的指标和评分；`years` 支持 `1/3/5/10` |
| `/api/ibkr-valuation?years=5&fresh=1` | 请求刷新；受最小请求间隔和各来源缓存约束 |
| `/api/ibkr-valuation/snapshot` | 同一批原始输入计算出的四个窗口 |
| `/api/ibkr-valuation/history` | 本机保存的最近 48 个采集快照 |
| `/api/ibkr-valuation/audit/{id}` | 读取指定快照保存的四个窗口结果、原始输入和规则版本 |

接口仅接受本机同源 GET。快照保存在 `.sparkflow/valuation-audit`，保存公开市场数据，不包含账户资料。规则与输入共同决定快照编号；已保存的结果不可覆盖，后续规则修改不会改变历史结果。

## 指数与行情状态

指数优先通过 `scripts/ibkr-valuation-snapshot.py` 连接本机 IB Gateway / TWS，合约为 `IND VIX/CBOE`、`IND SPX/CBOE`、`IND NDX/NASDAQ`。合约必须由券商唯一确认。

连接使用独立非零 client ID、`readonly=True` 和 `StartupFetch(0)`，不同步账户、持仓或订单，不请求付费 regulatory snapshot。默认在本机常用端口 `4002`、`4001`、`7497`、`7496` 中寻找已开启的 API。可通过以下环境变量指定本机行情连接。

| 环境变量 | 默认值 |
| --- | --- |
| `SPARKFLOW_VALUATION_IBKR_HOST` | `127.0.0.1`；只允许 loopback |
| `SPARKFLOW_VALUATION_IBKR_PORT` | 自动检查本机常用端口 |
| `SPARKFLOW_VALUATION_IBKR_CLIENT_ID` | `179`；必须大于 0 |
| `SPARKFLOW_VALUATION_PROXY` | 沿用项目代理 `http://127.0.0.1:7890` |

`reqMarketDataType(3)` 允许未订阅时返回延迟行情，有实时订阅时 IBKR 会自动返回 type 1。状态依据实际返回的 marketDataType 区分实时、延迟、冻结；只有历史日线可用时标记收盘。报价只有接收时间而无成交时间时在说明中明确标注。

历史调用 `reqHistoricalDataAsync`，使用 `1 Y / 1 day / TRADES / useRTH=True`，按年份分块，最多两个历史请求并行。已下载的年份缓存在 `.sparkflow/valuation/ibkr-history`。当前年份一小时更新，历史年份三十天更新；本次时间预算不足时，下次刷新继续补齐。不会把稀疏、未覆盖的历史描述为完整十年。

用户已允许没有 IBKR 行情时使用 Yahoo 或官方数据。备用顺序是 Yahoo Finance 的 `^VIX`、`^GSPC`、`^NDX`，然后是指数编制方经 FRED 发布的 `VIXCLS`、`SP500`、`NASDAQ100`。Yahoo 保守标记为可能延迟，时间使用 `regularMarketTime`；FRED 始终标记日收盘。每个原始序列保持同一来源，不将 Yahoo 历史接在一个标为 IBKR 的报价上。

## 估值和情绪

| 数据 | 口径 | 刷新频率 |
| --- | --- | --- |
| 标普500 TTM P/E | Multpl 的过去十二个月 as-reported 盈利口径；月度历史，最新值为估计值；不使用 CAPE | 六小时 |
| 前瞻盈利收益率 | `100 ÷ FactSet 未来12个月一致预期 P/E`，单位 %；解析最新 Earnings Insight 官方 PDF 第一页，同时记录报告发表日 | 六小时 |
| 10 年期美债 | FRED `DGS10`，美联储 H.15 固定期限名义收益率，单位 %，日频 | 一小时 |
| CNN 恐惧贪婪 | CNN Markets 发布的 0–100 指数快照和实际返回历史；不补造早期记录 | 五分钟 |

FactSet 最新报告入口为 `https://www.factset.com/earningsinsight`，重定向到带日期的 `advantage.factset.com` 官方 PDF。PDF 解析失败时才尝试 FactSet 最近公开文章中明确标注的 forward 12-month P/E；不会使用 TTM P/E、年度 EPS 或旁边的五年平均值代替。

公开 FactSet 报告的时间序列只积累确实获取到的历史快照。这能提供当前前瞻收益率及 ERP，但完整历史分位可能不足。不能把当前盈利预测向过去回填，不能把最近几个快照称为五年或十年历史。FRED 的标普500历史按来源授权约为十年。

### 导入已有的前瞻估值历史

可将有来源的标普500 NTM 一致预期历史保存为 `.sparkflow/valuation/forward-pe.csv`，UTF-8，表头必须为 `date,forwardPE,sourceUrl`。每行需包含 `YYYY-MM-DD` 公布日期、正的 NTM P/E 和 HTTPS 来源链接。该文件优先于自动 FactSet 来源；`date` 必须是该预测当时已经公布的日期。不要混入 TTM、市盈率五年平均值、年末预测或今日重算的过往估值。解析器拒绝缺少来源、无效日期、未来日期与无效比率。

文件仅保存在被 Git 忽略的本机 `.sparkflow` 目录。需要数据更新时替换 CSV 后重启开发服务，或等待六小时估值缓存到期。面板实际评分公式、权重、历史覆盖检查和缺失数据处理由 `server/ibkrValuationModel.ts` 管理。

模型 v1.1 的 ERP 评分使用明确的固定标尺，ERP 为 −2 个百分点时计 0 分，+4 个百分点时计 100 分，中间线性映射并封顶。该评分不冒充 ERP 历史分位。前瞻盈利收益率和 ERP 的历史色条只在实际历史足够时显示分位；当前快照、历史分位、合成分数各自保留口径。

## 时间与异常处理

IBKR 连接最多等待五秒，连接后本次历史填充预算十八秒，进程桥接总等待上限二十七秒。Yahoo 和官方备用数据并行获取，所以 Gateway 超时不会再串行叠加一次完整备用请求。日线完成分块后立即保存；再次刷新可补齐未完成年份。

每组指数获取和每个慢速数据来源另有三十二秒整体时限。FactSet PDF 模块导入最多三秒，文档加载及第一页文字提取最多五秒；超时销毁 PDF loading task，清理过程不阻塞接口。服务重启后按本地数据文件修改时间恢复尚未过期的慢速来源缓存，同时保留各来源原有 `asOf`，避免开发热重载反复下载并解析同一份报告。

来源会随行情权限和网络可用性变化。用户看到的来源标签以当前实际返回序列为准。源站失败时保留上次真实数据并标记 `stale`，不把旧时间改为现在，不把 `null` 转成零，不重构不存在的历史。不提供下单、撤单、账户发送或订阅购买功能。

## 来源文档

- [IBKR 市场数据类型](https://www.interactivebrokers.com/docs/tws-api/doc/market-data-delayed/market-data-type-behavior)
- [IBKR 历史日线](https://www.interactivebrokers.com/docs/tws-api/doc/market-data-historical/historical-bars/requesting-historical-bars)
- [IBKR 历史请求步长](https://www.interactivebrokers.com/docs/tws-api/doc/market-data-historical/historical-bars/step-sizes)
- [Multpl TTM P/E 定义](https://www.multpl.com/s-p-500-pe-ratio)
- [FactSet Earnings Insight](https://www.factset.com/earningsinsight)
- [FRED DGS10 定义](https://fred.stlouisfed.org/series/DGS10)
- [FRED 标普500](https://fred.stlouisfed.org/series/SP500)、[纳指100](https://fred.stlouisfed.org/series/NASDAQ100)、[VIX](https://fred.stlouisfed.org/series/VIXCLS)
- [CNN Fear & Greed](https://www.cnn.com/markets/fear-and-greed)
