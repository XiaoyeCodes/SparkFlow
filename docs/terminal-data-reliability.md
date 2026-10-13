# 终端数据刷新与故障恢复

2026-10-13 修复并验收。以下频率是检查来源或读取缓存的频率，不代表来源每次都发布新数值。

| 数据 | 服务端检查 | 浏览器检查 | 主备与有效快照 |
| --- | --- | --- | --- |
| VT 全球股票 | 3秒 | 3秒 | 新浪和腾讯并行选较新报价，Yahoo备用；来源时间保留，全部失败时最多使用1小时内的缓存 |
| CPI / PPI / 非农 / 失业率 | 2分钟 | 1分钟 | BLS新闻稿与FRED官方序列同时启动，3秒内选择最新已完成统计期，同期优先新闻稿；失败保留最近验证快照，最多7天 |
| PCE | 2分钟 | 1分钟 | BEA新闻稿、FRED PCEPI；预期独立读取，缺失不阻塞实际值 |
| PMI及宏观预期 | 2分钟 | 1分钟 | Trading Economics，直连、代理和文本镜像回退；预期只接受同统计月且实际值匹配的日历记录 |
| VIX / VXN / CNN | 各2分钟 | 各15秒 | 三个独立请求、缓存和重试；VIX/VXN使用Yahoo和FRED日收盘备用，CNN不阻塞另两项；成功快照最多24小时 |
| 四条核心指数曲线 | 各5分钟 | 各5分钟 | FRED NASDAQ100/SP500/NASDAQSOX、腾讯上证日K，Yahoo备用；独立于3秒报价，快照最多6小时 |
| 美债期限利差 | 2分钟 | 1分钟 | FRED T10Y2Y，直连失败走代理，独立请求 |
| 美联储利率预期 | 15分钟 | 15分钟，失败1分钟重试 | 会议月ZQ期货结合日度EFFR估算；EFFR使用FRED DFF与纽约联储日度EFFR，按观测日期选较新值；不使用月平均FEDFUNDS替代当前利率；快照最多6小时 |
| NFCI / HY OAS | 2分钟 | 成功15分钟、失败1分钟 | FRED两个序列并行，独立保留最后成功序列；单项失败不清空另一项，旧验证数据最多保留7天 |

## 不随故障改变的口径

- 非农 `PAYEMS` 是季调就业人数，单位千人。新增非农是本月减紧邻上月；前值是上月减上上月，使用同批次修订值，不能除以1000或跨月缺口相减。失业率读取同月季调 `UNRATE`。
- CPI同比使用未季调 `CPIAUCNS`，环比使用季调 `CPIAUCSL`；PPI同比分别使用未季调 `PPIFID` 和环比季调 `PPIFIS`；两条序列按最新共同月份对齐。
- PCE备用使用季调 `PCEPI` 的紧邻月变化，按BEA标题数据的一位小数精度取整，再沿用界面的两位小数格式，避免来源切换造成虚假的精度差异。
- FRED波动率备用是日收盘，不是实时价格。卡片显示“最近收盘”、来源和观测日期；不能让较旧的日收盘覆盖较新的有效报价。
- 利率概率是会议月期货加权模型的估算，不是CME直接发布的FedWatch概率。0.0%可以是有效计算结果，不代表数据缺失。接口保留期货时间、EFFR时间、来源与合约。
- 预期缺失显示“—”，不能拿实际值、旧月份或不匹配的市场记录代替。实际值与预期分别保存来源。

## 缓存、并发与恢复

后端普通、实时、宏观三类任务分别保留2/4/6个执行名额；同一键进行中的抓取共用一个任务。40项终端资源启动预热并恢复有效磁盘快照，浏览器先显示准备好的结果，再独立同步。宏观指标和金融条件的故障快照以原 `lastSuccessAt` / `fetchedAt` 计算硬有效期，响应标记为stale并退避重试；每次失败、重启或读取缓存都不能延长该期限。

单项无效、超时或日期倒退时不覆盖已显示的有效数值。来源恢复后自动替换；超过硬期限或全部来源从未成功时，仍应明确不可用。代码不能承诺外部免费来源永不拒绝访问，也不能为消除空态而填造数据。

## 验收入口

`npm run test:terminal-reliability` 验证来源字段、单位、预期匹配、超时、重启、缓存期限与退避。另有 `test:macro-release`、`test:cpi-fallback`、`test:core-index-history`、`test:public-cache`。浏览器用例为 `tests/ibkr/terminal-reliability.spec.ts`，覆盖独立首屏、CNN阻塞、VT/VIX失败保留及来源恢复。

本机验收：VT主备报价恢复；2026年9月非农实际+29K、前值+133K、预期+90K；同月失业率4.2%、前值及预期4.1%。这些数字仅记录验收结果，不作为程序默认值。

口径来源：[PAYEMS](https://fred.stlouisfed.org/series/PAYEMS)、[UNRATE](https://fred.stlouisfed.org/series/UNRATE)、[PPIFIS](https://fred.stlouisfed.org/series/PPIFIS)、[PPIFID](https://fred.stlouisfed.org/series/PPIFID)、[BEA PCE](https://www.bea.gov/data/personal-consumption-expenditures-price-index)、[纽约联储EFFR](https://www.newyorkfed.org/markets/reference-rates/effr)。
