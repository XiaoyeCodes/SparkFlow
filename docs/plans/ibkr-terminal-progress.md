# IBKR terminal progress

## 当前阶段与下一步

- 阶段：真实 paper 账户与受管写入通道已连接；账户、合约查询和历史 K 线已从 IBKR 返回。用户已要求测试买入 100 股 NVDA，但尚未给出限价与风险授权范围；模拟盘策略仍未启用，未向券商发送订单。2026-09-09 最新探针显示 NVDA 实时、延迟和延迟冻结 feed 均无报价，继续保持诚实缺失状态。

- 下一条可执行操作：等待用户补充这笔 NVDA 100 股模拟限价单的限价、单笔／总敞口／单标的／日亏损／价格偏离／手续费／频率上限和授权有效期，并在 IBKR 模拟用户名获得可用 tick 后生成一次性预览；用户单独确认预览后才执行下单→回报→撤单→对账。若行情权限或当日 PnL 不足，记录拒绝证据且不发送订单。

- 长期目标：用户目标为完整模拟盘下单、撤单、持仓查看与行情接入；当前仍 active，未完成。



## 任务状态

| ID | 状态 | 实现文件 | 验证命令／结果 | 证据 | 阻塞 |

| --- | --- | --- | --- | --- | --- |

| P0.1 参考归档与截图 | VERIFIED | docs/design/ibkr/trading_terminal.reference.html；screenshots/ | node --test tests/ibkr/reference.test.mjs；e2e 2 passed | SHA256 与计划一致；1440×1000 / 1920×1080，已查看 1440 图 | |

| P0.2 契约与范围 | VERIFIED | docs/design/ibkr/contracts.md；src/ibkr_terminal/schemas.py | Python 验证 v1 快照、Decimal 文本、账户隔离与样本标识 | contracts.md | 未来端点尚未实现，已明确标注 |

| P0.3 复用审计 | VERIFIED | docs/design/ibkr/reuse-audit.md | 源码审计；3 个 IBKR profile 写入拒绝测试通过 | reuse-audit.md | 真实只读、回测金标准待后续 |

| P0.4 离线测试入口 | VERIFIED | package.json；playwright.ibkr.config.ts；requirements-ibkr-test.txt | unit：1 JS + 11 Python passed；e2e：2 passed；performance：如期 exit 2 BLOCKED | 默认 Python socket 禁用；参考网页网络阻断 | 性能工具待 P8 实现，绝非性能通过 |

| P0.5 固定接口样本 | VERIFIED | tests/ibkr/fixtures/snapshots.json | 7 场景及无浮点／串账户／伪装测试通过 | test_contracts.py | |

| P1.1 布局及基本交互 | VERIFIED | src/routes/IbkrAccount.tsx/.css；src/components/ibkr/；src/lib/ibkr/ | tsc 通过；e2e 共 9 passed；5 视口；unit 3 JS + 11 Python | screenshots/terminal-empty-*.png，已查看 1440×1000 与 390×844 | |

| P1.2 完整数据状态与视觉验收 | VERIFIED（软件） | market_data.py、marketData.ts、PriceChart.tsx、IntelligencePanel.tsx；terminal.spec.ts；ui-state-matrix.md | 历史行情 10,000 根、28 e2e；tsc/build passed | 逐区 loading/empty/error/stale/permission 矩阵；账户过期与行情权限定向浏览器测试；控件名称/焦点/颜色对比度；截图 | 真实数据不以样本代替；真实行情状态待账户核对 |

| P2.1 会话／存储／接口边界 | VERIFIED | agent/src/ibkr_terminal/app.py、session.py、store.py | unit 3 JS + 16 Python passed；账户串用、旧 revision、序号回退、重启 stale、Host/Origin/session、四种写方法拒绝 | test_session.py、test_api.py | 尚未连接 IBKR |

| P2.2 常驻只读适配、启动与 HTTP 代理 | VERIFIED | readonly.py、__main__.py；scripts/start-ibkr-terminal.ps1；server/ibkrTerminalProxy.ts；vite.config.ts | unit：4 JS + 19 Python passed；真实本机未绑定服务探针通过 | docs/runbooks/ibkr-terminal-development.md | SDK 使用 fake；真实账户核对未运行 |

| P2.3 WebSocket／心跳与页面恢复 | VERIFIED | events.py、session.py、app.py、readonly.py、__main__.py；src/lib/ibkr/events.ts、stream.ts；ibkrTerminalProxy.ts | 6 JS + 22 Python passed；12 浏览器 passed；test:ibkr:stream 真实本机空账户流通过 | 新 tests/ibkr/events.test.mjs、test_events.py、增量／缺序号／心跳 e2e；令牌不进浏览器 | fake SDK 与本机 unbound，不代表真实券商验收 |

| P2.4a 主动只读对账与来源 | VERIFIED | readonly.py、sdk.py、broker_views.py、schemas.py；SnapshotProvenance.tsx、AccountTables.tsx | unit：7 JS + 26 Python passed；e2e 13 passed；tsc passed；本地 unbound WS 探针 passed | test_reconciliation.py、test_sdk_observations.py：真实 SDK 回调接 fake transport，无 socket／写方法 | 非真实账户验收；更正与历史审计留待 P3 |

| P2.4b 真实账户核对 | VERIFIED（paper 只读首轮） | 只读启动与绑定框架、market/contracts、market-data | 2026-09-06 本机 Gateway 4002 + 账户服务 8765：session/snapshot 200，`source=ibkr`、`testData=false`、`connection=connected`、账户摘要和 USD 风险字段返回；SPY 合约与 1D/5D/1M 历史 K 线返回 | `docs/design/ibkr/connection-check-2026-09-06.json`、`market-connectivity-2026-09-06.json` | 实时 feed 仅 delayed/过期（IBKR_10089/10167）；paper 下单/撤单需用户精确范围、Gateway 写权限、实时成交报价和当日 PnL |

| P3.1 订单身份／原子预占 | VERIFIED | orders.py、risk.py、audit.py；test_orders.py | 27 离线测试 passed | 20 请求／8 线程／独立 SQLite 连接只预占一笔；重复／重启、同键异体、撤权、陈旧行情、缺数据、卖出超持仓、多策略日限额、集中度、外部挂单预占 | 首步只含 DAY 限价、整股、USD 现金范围；未接 API／券商写入 |

| P3.2a 一次性提交与 UNKNOWN 恢复 | VERIFIED | broker.py、orders.py；test_submission.py | 9 新增测试 passed；全量 unit 7 JS + 60 Python passed | 并发／真实等待中的重复、超时、撤权／过期重查、重启恢复；未发生真实请求 | 只接受显式 fixture transport；生产写入仍关闭 |

| P3.2b 管理订单事件与账户对账 | VERIFIED | reconcile.py、orders.py、risk.py；test_order_events.py | 新增 12 用例；全量 7 JS + 72 Python passed | 部分成交→撤单期间再成交→手续费→现金／持仓核对后释放；重复／更正／串账户／事件屏障／旧快照重用 | 离线管理订单账本；外部现金流／券商更正映射、真实读写尚未接通 |

| P3.2c 提交前身份与 UNKNOWN 只读匹配 | VERIFIED | identity.py、orders.py、broker.py、reconcile.py；test_order_identity.py | 10 新增用例；全量 7 JS + 85 Python passed | 发送前从第二连接读到持久身份；8 并发 ID 唯一且尊重新 broker floor；超时只读匹配不重发 | 尚无真实写 transport；完整撤改与 UI 待续 |

| P3.2d 撤单命令生命周期 | VERIFIED | broker.py、identity.py、orders.py、reconcile.py；test_cancel.py | 5 新增用例；全量 7 JS + 90 Python passed | 发送前落盘、重复／超时／重启不重发、先成交 TOO_LATE、即时 ACK 不被本地返回覆盖 | fake transport；不代表真实券商撤单验收 |

| P3.2e 独立确认与版本化改单 | VERIFIED | amendments.py、risk.py、orders.py、identity.py、reconcile.py；test_amendments.py | 10 新用例 passed；全量 7 JS + 104 Python | 原意图不可变、同券商身份、风险增加预占／下降延后释放、部分成交、撤权、超时、并发事件、频次与双在途恢复 | fake transport；真实 SDK 发送／明确拒绝映射及 UI 仍待接 |

| P3.2f 固定 SDK 命令编码 | VERIFIED | order_codec.py；test_order_codec.py | 4 新用例 passed；全量 7 JS + 104 Python | 实际 ib_async.Client.placeOrder 编码，send 截获且 socket 禁止；Decimal／账户／身份保留，本地 PendingSubmit 不能生成 ACK | 纯编码器，无真实 transport；不代表券商接受订单 |

| P3.2g 风险数据／订单接口与界面 | VERIFIED（软件） | reviews.py、orders.py、app.py、orderClient.ts、OrderTicket.tsx、ibkrTerminalProxy.ts | 全量 14 JS + 186 Python；28 e2e；tsc/build 通过 | 无副作用预览、原子本地确认、API／代理窄白名单、paper 中栏订单票；逐状态拒绝；live 明确关闭 | 生产可信风险 source／真实 paper 测试需用户配置与单独授权 |

| P3.2h 原始 SDK 回报与 UNKNOWN 归属 | VERIFIED（离线） | managed_events.py；sdk.py；test_sdk_managed_events.py | 初始缺模块失败；openOrder 新增 7 失败后修复；定向 42 passed；全量 14 JS + 203 Python passed | SDK 原始回调在无 Trade 缓存下仍持久化成交/手续费；更正链跨重启；完整条款恢复 UNKNOWN；未凭 SDK 默认值补数量 | 生产未挂接此 observer；写 transport、改单/错误回报及真实核对待续 |

| P3.2i SDK 改单确认与错误回报 | VERIFIED（离线） | reconcile.py、amendments.py、managed_events.py、sdk.py；test_sdk_managed_events.py | 改单 2 失败、错误 6 失败→修复；回报定向 38 passed；全量 14 JS + 211 Python passed | 只读确认复用原改单核对规则，不依赖可写 transport；SDK 错误不能伪造撤单终态；原始错误文本不进入管理账本/日志 | 真实接入未运行；错误后保持 halt，解除须后续显式恢复核对，不自动解锁 |

| P3.3a 原生新订单发送适配 | VERIFIED（离线） | native_dispatch.py；orders.py v6；test_native_dispatch.py；test_order_migration.py | 初始缺模块失败；超时/编码中到期/中断/恢复/真值字符串先失败→修复；全量 14 JS + 229 Python passed | 18 新用例；真实 SDK 序列化，conn.sendMsg 截获且 socket 全禁；发送前第二连接可见双重落盘；禁止 SDK 延后队列；许可/授权/风险在最后 wire 边界复核；无 ACK 超时 UNKNOWN，不重发 | 仅提交命令；撤改发送及生产配置/许可签发/UI/风险 source 待补；真实 paper/live 未运行 |

| P4 策略与回测 | VERIFIED（软件）／BLOCKED（用户策略验收） | strategy.py、signals.py、backtests.py、workers.py；BacktestWorkspace；P4 tests/API | 290 Python + 2 JS、167 workbench、定向 Playwright 1/1、TypeScript、生产构建 | 不可变用户策略版本、JSON/CSV 数据导入、服务端数据哈希与信号生成、后台运行/取消、结果与完整重放包导出 | 仍需用户提供并验收自己的策略与合法数据；工程 SMA 示例不算用户策略验收 |

| P5 策略 paper 运行 | DOING（软件）／BLOCKED（真实） | strategy_runtime.py、signals.py；strategyRuntime.ts；StrategyWorkspace.tsx；运行 API/代理与测试 | 共享信号的回测/paper 适配一致；6 runtime + API；全量已纳入 | 序列/重启/陈旧/冲突 fail-closed、两策略共用原子现金、只停止新增信号；只生成本地意图 | 软件仍缺执行适配/激活恢复链；另需用户策略、账户、范围、风险授权及两个真实 paper 交易时段 |

| P6 AI 与报告 | DOING（软件）／BLOCKED（外部） | analytics.py、intelligence.py、reports.py、report_jobs.py；reportEvidence.ts；服务端边界、API、右栏/底栏与测试；工程报告/截图 | 全量 14 JS + 186 Python；28 e2e；报告定向 16 passed；schema v2 PDF 2 页 A4 目视、文本与 2 个来源链接注释验证 | 默认拒绝分享；新闻双时间/安全链接/HTML 转义；宏观来源/时间；新闻精确代码关联、宏观非因果账户上下文、微观缺口；摘要/概况/缺失归因/建议/限制；三代哈希兼容；持久四格式报告 | 软件仍缺模型调用/分享管理/报告显式重试；另需模型/字段/预算与真实微观源/权限 |

| P7 live 就绪 | DOING（软件）／BLOCKED（真实） | AuthorizationMatrix.tsx；docs/runbooks/ibkr-live-readiness.md；生产 live/runtime/order 拒绝路径 | 全量回归包含 live 拒绝与四类授权分离；ib_async 2.1.0 已记录 | 页面授权表、账户/行情/限额/期限、备份恢复及人工应急清单 | 默认拒绝已验证，可授权启用链仍缺软件；live 只读核对和任何写入均待明确授权 |

| P8 性能与交付 | VERIFIED（软件） | verify-ibkr-performance.mjs、performance/*.json、maintenance.py/CLI、runbooks | 冻结候选 60min passed：LCP 876ms、图表 1740.65ms、事件→页面 p95 4.42ms、点击 p95 58.08ms；3594/3594 patch、WS 1/1、队列 0/1、重同步 0、42 requests 恒定、无失败请求/控制台错误；备份/验证/恢复成功 | 50 持仓/500 订单/10,000 K 线生产 fixture；120 样本稳定 heap 15.33–17.76MB、DOM 五档循环；构建清单 48/48；四项宏观/缓存回归 passed | headless rAF 240.09 只是持续主线程卡顿探针，不是物理屏刷新率；真实账户长期表现仍须外部验收 |



## 决策与范围

- 已确认：主计划 v1.0；参考布局不可重设计；仅授权开发、离线测试、本地验证。

- 工程首期假设：美股／ETF、整股、只做多、常规时段；不是交易授权。

- 待确认：真实连接配置与账户、用户策略、风险额度、行情权限、AI 分享及预算。

- 保留原宏观修复，不增加宏观卡片底部更新日期行。



## 权限边界

- paper 写入授权：用户已指定当前模拟账户、NVDA、BUY 100 的测试意图；限价、风险上限和有效期仍未提供，因此授权不完整，订单策略保持 disabled，未访问下单接口。

- live 写入授权：未提供；默认关闭。

- AI 账户分享：未提供；默认关闭。

- 不采集密码，不操作 MFA、开户、入金、订阅或券商权限。

- 不创建定时任务，不提交或推送。



## 恢复信息

- 当前分支／提交：`codex/global-macro-dashboard-v2` / `ea3c57d878d577de1433d5278ffc6ee342ab7d43`。

- 初始 Git 状态：无 tracked 修改；用户既有未跟踪文件 `docs/plans/2026-09-04-ibkr-codex-goal.md`、主计划及 `output/`，保持原样。

- 本次修改文件：本文件、docs/design/ibkr/、tests/ibkr/、scripts/verify-ibkr-unit.mjs、scripts/verify-ibkr-performance.mjs、playwright.ibkr.config.ts、package.json/lock、.gitignore、services/vibe-trading/requirements-ibkr-test.txt、agent/src/ibkr_terminal/、agent/tests/ibkr_terminal/。

- 运行中的本任务进程：Gateway `127.0.0.1:4002` 与 IBKR 账户服务 `127.0.0.1:8765` 当前监听；Vite `127.0.0.1:5180` 保持运行。未绑定数据库及本地会话令牌保留在已忽略且限制 ACL 的 `.sparkflow/ibkr-terminal/`。

- 测试与证据位置：`docs/design/ibkr/`、`tests/ibkr/`；浏览器临时输出 test-results/ 已忽略且现有 Vite watch 已排除。



## 执行日志

- 2026-09-06 恢复检查：上轮中断导致本进度文件和连接 runbook 被零字节覆盖；已从本地 session 日志恢复历史证据，并保留零字节副本在 `.sparkflow/ibkr-terminal/recovery/`（Git 忽略）。绑定 JSON 可解析，orders.sqlite/terminal.sqlite quick_check=ok，订单库 0 笔；没有提交本地令牌、数据库或探针。
- 2026-09-06 行情与服务：补充非持仓合约搜索、报价与历史行情入口、成交后账户证明核对。新版账户服务已启动并读取 `source=ibkr`、`connection=connected`、`state=empty`，paper 执行仍 false。行情接口将 feed 查询参数改为运行时校验整数，修复浏览器 URL 字符串导致的 422；等待最终 unit/e2e 回归。

- 用户选择 IB Gateway 并明确要求下载：从 IBKR 官方页面 https://www.interactivebrokers.com/en/trading/ibgateway-latest.php 解析 Stable Windows x64 链接，HTTPS 下载至 C:/Users/ATLAS/Downloads/ibgateway-stable-standalone-windows-x64.exe，331,316,920 bytes。Authenticode Status=Valid，签名者 Interactive Brokers Group, Inc.；SHA256 F1A87D9067723E6AC31018530A4CCBFD0CC217D1709B617A25FE6D736B4B0203。仅下载并核验，未安装/运行安装程序，未登录、修改 API 设置或连接账户；安装器 FileVersion=1.045.1.10 不作为实际 Gateway 运行版本。真实只读账户绑定与 paper 测试范围仍待用户确认，开发下一步保持 P3.3b。

- 用户询问当前能否查看模拟盘及连接方法：实际检查 5180/ibkr HTTP 200；8765 和默认 paper API 7497/4002 无监听。已请求在 Codex 打开页面（工具返回 queued），未连接 IBKR。新增 docs/runbooks/ibkr-paper-connect.md 与默认 confirmed:false 的无真实账号模板，说明只读登录/端口/账户绑定/启动/逐项核对；参考 IBKR 官方配置说明，保留 Read-Only API。用户尚未指定账户或确认真实 paper 测试范围，下一开发步骤仍为 P3.3b。

- 本轮恢复分类为 progress；Git 与检查点一致，继续 P3.3a。使用已读 Code/executing-plans/security-auditor 技能及既有批准设计，不重新规划审批，不改用户宏观修复。

- P3.3a RED→GREEN：native_dispatch 模块缺失时先确认收集失败。新增默认 disabled 的 NativeDispatcher；DispatchPermit 绑定精确 commandHash、只读账户绑定哈希、channel/revision、source、策略/人工授权哈希、用途与有效期，许可不可变且可撤销。record_permit 只是内部持久化，不证明已获得用户同意；生产没有签发/启用入口。旧 OrderExecutor 与 AmendmentManager 的 fixture-only 写 gate 保留。

- P3.3a 发送：复用现有 OrderLedger.claim_submission 的授权/Decimal 风控/预占/身份事务，新增独立 SDK dispatch WRITING 记录先提交；发送时另持数据库写锁复核许可与风险，SDK 原生编码后在 conn.sendMsg 最后边界再次核验。使用固定 ib_async 2.1.0；要求同 owner loop、实际 client host/port/clientId、明确返回账户及同一原始回报 observer。SDK 已排队/限流直接拒绝，不把授权请求留给延后发送；SDK DEBUG 原始报文日志开启时拒绝写入。

- P3.3a 状态：SENT 只代表本地 hand-off，order.submission 仍 SUBMITTING，只有原始 openOrder 完整证据才 ACKNOWLEDGED。默认 10s（上限 60s）的本地确认计时器不阻塞事件循环；超时/关闭/异常/中断为 UNKNOWN，保留预占并禁止重发。最多 64 个待确认 timer；正常回报到来后到期检查不覆盖 ACK。数据库迁移 v6 新增 sdk_dispatch_permits/attempts；v1→v6 用例保留旧 UNKNOWN/余额并验证新表为空，恢复时同步原生 attempt 为 UNKNOWN。

- P3.3a 追加失败证据：编码过程中 clock 到期曾仍发送，增加 wire 边界复核；BaseException 曾遗留 SUBMITTING，现持久 UNKNOWN 后重新抛出；重启原生 receipt 曾保留 SENT，现与主账本一起恢复 UNKNOWN；enabled='false' 曾被 Python 真值视为启用，改为必须严格为 True。测试握手对象初期析构产生未就绪警告，改为 contextmanager 在关闭 dispatcher 后 reset 测试 client，无真实 disconnect 调用或警告隐藏。

- P3.3a 最终：`npm run test:ibkr:unit` 14 JS + 229 Python passed，仅 1 条既有 Starlette/httpx 弃用警告；`git diff --check` exit 0（既有 CRLF 提示保留）。只改原生适配、订单库迁移与对应测试/文档；未改前端，不重跑已通过的截图/构建/60 分钟长测。没有真实连接、订单、账户外发、提交/推送、定时任务或新的后台进程。下一步 P3.3b；长期目标 active。

- P3.2i RED→GREEN：两个原始改单回报用例先失败；将既有 AmendmentManager.confirm 的核对/落盘逻辑集中到只读 OrderReconciler.confirm_amendment，原入口仍先校验 broker channel。原始 openOrder 匹配待确认新版本，旧条款回声不确认新版本；未发送的本地改单不能被回报伪装成已发送。中途用例因沿用 NOW+1 账户证明早于 NOW+2 回调而 STALE_ACCOUNT_PROOF，修正测试来源时间后通过，未放宽时效检查。

- P3.2i 错误 RED→GREEN：新增 201/202/321/10147 与请求 ID 冲突/1100→1102 用例先失败；现在只记录 IBKR_错误码、保留最后已确认执行状态和最大预占、持久 halt。SDK 对管理订单错误的本地 Cancelled 推断被隔离；原错误文本/advanced JSON 不存日志和审计。活动只读请求的同号错误不会修改订单；连接恢复通知不会自动清除 halt。未定义真实错误后的人工恢复流程，继续列为软件缺口。

- 本轮最终验证：`npm run test:ibkr:unit` 14 JS + 211 Python passed（25 个新增原始 SDK 用例；1 条已知 Starlette/httpx 弃用警告）；`git diff --check` exit 0；冻结前端/代理/dist 清单 48/48 SHA-256 unchanged，原长测仍只代表该前端工程构建。未运行真实集成、浏览器重测或新的长测；未新增后台进程、交易、AI 外发、提交/推送、定时任务。下一步 P3.3，目标保持 active。

- P3.2h RED→GREEN：新增测试最初 ModuleNotFoundError；实现 ManagedOrderObserver 后 10 passed。随后 7 个 openOrder 测试先失败，再添加完整账户/orderRef/channel/条款匹配；最终定向 42 passed，统一 unit 14 JS + 203 Python passed（保留 1 条 Starlette/httpx 弃用警告）。所有测试由 pytest-socket 禁网，未连接券商。

- P3.2h 语义：原始回调在 SDK 缓存/默认值处理前进入同一 OrderReconciler；openOrder 不携带 filled/remaining，因此只恢复归属，仍要求 orderStatus/成交/账户证明。成交按 execId 去重，数字后缀更正保留原执行与链，缺前序拒绝；迟到手续费从持久执行身份匹配，返佣保留符号。未知手续费没有账户身份时不能绑定。Inactive 保持未决；身份错误/无效数字/缺时区通过 SDK wrapper 持久化 halt，审计只记错误码。

- 本轮文件：managed_events.py、sdk.py、test_sdk_managed_events.py、本进度、contracts.md 与新增 software-gaps.md。未改前端、宏观模块、授权 gate、生产启动或连接配置；没有重复执行已通过的浏览器/构建/60 分钟测试。git diff --check exit 0（已有 LF→CRLF 提示保留）。默认 ObservedIB 不设置 observer，生产行为仍只读；目标 active，软件尚未全部完成。

- 2026-09-05 本轮恢复：沿用 /goal 已建立的 active goal；分支/HEAD 与检查点一致，保留全部已有工作区修改。原 HTML 与归档 SHA-256 再核对均为 F80E02E4852D19D366544228D37B7C1878EF1D8974A8B9D21FE4628DB14EE14D；不重新归档/运行已通过长测。源码确认真实 transport、可信生产风险上下文、策略可运行接入与模型调用仍缺实现，不能称软件全部就绪。P3.2h 开始 DOING，先建失败测试。

- 2026-09-05：完整读取主计划、Code、brainstorming、executing-plans 技能。已有批准设计与持续执行授权优先，不重复规划审批。

- P0 RED→GREEN：归档测试最初 ENOENT；复制原字节后通过。契约测试最初 ModuleNotFoundError；实现模型／样本后发现测试路径 parents[6] 指向 Documents，修为 parents[5] 后 11 passed。没有删除失败测试。

- 浏览器初次缺 Chromium；下载遇到 TLS ECONNRESET，改用已安装 Chrome，2 passed。离线截图阻断远程字体，固定测试时钟与随机值，归档源文件未改。

- 环境补齐：ensurepip 与 pytest/pytest-socket；npm 安装精确锁定 Playwright，未执行安装脚本。未运行 npm build 的 prebuild 服务准备。

- 当前没有任何真实账户、paper/live 写入、AI 分享或用户策略验收；没有提交／推送。

- P1 RED→GREEN：首次 terminal 浏览器测试找不到 ibkr-terminal；store 测试找不到模块。实现后检测到同级 workspace/AI 使用重复 key 导致模式切换旧图表残留，改为独立 key 后 9/9 通过。未降低断言。

- P1 验证：npx tsc -b --pretty false；npx vite build 均 exit 0。直接调用 vite 避开 npm prebuild 中服务依赖安装副作用。生产主包约 1.97MB，有 >500KB 警告；不是性能验收。

- 回归：npm run test:macro-release、test:market-cache、test:isolated-market-data 均 passed；未运行需真实源的 test:macro-cards。

- P1 当前前端读取新 /api/ibkr-terminal/snapshot 契约，P2 尚未接通时诚实未连接；旧只读桥保留。订单／策略／AI 均明确未就绪，不能称整页业务完成。

- 本批新增／修改：src/components/ibkr/、src/lib/ibkr/、src/routes/IbkrAccount.tsx/.css、Shell.tsx（IBKR 复用现有自动隐藏全局导航）、vite.ibkr-test.config.ts、terminal.spec.ts、store.test.mjs、playwright 配置。测试服务已自动退出。

- P2.1 RED→GREEN：会话/API 测试最初缺模块失败。实现 SQLite v1、明确账户绑定与只读 FastAPI 后测试通过。Windows asyncio 需要内部 socketpair，测试收集时先建事件循环，仅供 TestClient IPC；测试体仍由 pytest-socket 禁止所有新 socket，无券商连接。

- P2.1 测试保留 1 条 Starlette/httpx 弃用警告；未隐藏。运行时尚未启动。

- P2.2 RED→GREEN：readonly 模块缺失时测试失败，完成后验证 1 个持久连接、readonly=True、明确 brokerAccount 过滤、NaN→null、多币种、断线 stale。注入 SDK 的结果标记 fixture/testData，不能写生产快照库。

- 本机 ib_async 2.1.0 源码显示 clientId=0 会 reqAutoOpenOrders(True)，已服务端禁止并通过测试；connectAsync 限制 StartupFetch.ACCOUNT_UPDATES，不自动订阅所有子账户或绑定外部订单。

- P2.2 本地集成：start-ibkr-terminal.ps1 无 BindingFile 启动，session 200/accounts=[]，snapshot 200/unconfigured，token 文件访问 403，POST orders 403，恶意 Origin 403；目录 ACL protected=true/current user FullControl，未请求券商。

- 修复账户缓存重用漏洞：新增失败测试证明相同 accountKey 改 brokerAccount 曾能恢复旧缓存；数据库迁移 v2 绑定账户指纹后拒绝重用，19 Python tests 全通过。无来源的旧缓存保留但不自动恢复。

- 最新浏览器验证 10 passed，增加真正迟到 paper 请求返回 live 页面时不污染的用例；最新 TS 编译通过。没有真实交易、账户分享、定时任务、提交或推送。

- 运行说明与限制：docs/runbooks/ibkr-terminal-development.md。P2 尚不完整；P3–P8 大部分尚未实现，不能称软件阶段全部就绪。

- 本轮恢复：已重读主计划、进度和当前文件／Git 状态；上一轮属于 progress。无旧运行中的本任务进程，直接继续 P2.3；沿用已读取的开发与 security-auditor 技能。

- P2.3 RED→GREEN：新增 WS 测试初始缺 heartbeat 参数／subscribe；新增前端事件测试初始缺 events.ts；实现账户范围增量、5s WS 心跳、64 项有界队列、溢出 resync、8 订阅上限及退出清理后通过。旧账户断线回调以 expected_revision 拒绝，不能修改新绑定。

- 前端先 HTTP 快照再 WS；仅接受同账户／revision／连续序号，非法金额、payload 身份字段或缺口转补快照。重连有 5 次上限与退避，15s 无有效心跳后 stale；模式切换关闭旧请求与 WS。账户／持仓事件合并 100ms，未来订单事件不得走该合并器。

- 券商事件测试先失败：缺 healthy，断线后仍 connected；添加 accountSummaryEvent/positionEvent/disconnectedEvent 订阅及释放后，连接关闭立即 stale。账户周期刷新当前尚未构成主动券商对账，P2.4 明确保留。

- `npm run test:ibkr:stream` 启动独立 unbound ASGI 8767 与专用 Vite 5189，Chrome 实际收到 3 次 heartbeat，token 文件 403。首次探针因路由伪造页面导致 Chrome 本地网络检查拒绝；改为真实同源 HTTP 页面，未禁用安全设置。专用探针关闭依赖扫描和文件监听，因为不加载应用模块；避免扫描 tmp 中大量浏览器 HTML。所有子进程及临时目录在 finally 清理。

- 最新结果：npm run test:ibkr:unit = 6 JS + 22 Python；test:ibkr:e2e = 12 passed；test:ibkr:stream passed；tsc passed。Starlette/httpx 弃用警告保留。未运行 60 分钟浸泡或真实账户核对，未发送任何券商订单。

- P2.4a RED→GREEN：新增对账测试最初缺 clock；实现每 30s 主动请求持仓、所有可见挂单与指定账户成交，使用请求返回集合替换旧持仓，避免 SDK 缓存的幽灵持仓。事件刷新不推迟主动对账。任何请求失败保留旧快照并 stale，停止连接任务；不盲目重试。

- P2.4a 源时间：asOf 仅表示快照生成；metrics/cash 的 observedAt 只来自账户摘要回调，不随缓存读取更新；无券商原始时间时 brokerAsOf=null。positions/orders/executions 单列 requestCompletedAt；账户摘要当前保持 SDK 订阅更新，并非每 30s 重新请求。

- P2.4a SDK 边界：真实 ib_async 2.1.0 的 openOrder 会默认 filled/remaining=0 且已存在 Trade 的状态可能滞留；新增 ObservationWrapper 在只读请求期间保留原始状态，无 orderStatus 时数量 null，真实回报 0 才显示零。重复 execDetails 产生空手续费对象，现按相同执行身份取已收到的 commissionReport，迟到的真实零手续费可恢复。

- P2.4a 验证：原始 SDK 回调测试最初缺 sdk 模块；UNSET_DOUBLE 测试最初错误生成极大金额；修正后 26 Python + 6 JS passed。测试使用仅有读取方法的 fake transport 和 pytest-socket，无券商订单。前端成交按 execId 显示，手续费缺失明确标记，来源时间可展开，表格 25 行分页；单独新浏览器用例通过，完整回归待补。

- P2.4a 本轮最终回归：npm run test:ibkr:unit = 7 JS + 26 Python passed；npm run test:ibkr:e2e = 13 passed；npx tsc -b --pretty false passed；npm run test:ibkr:stream passed。新增前端 patch 测试覆盖空数量、缺手续费、来源时间、串账户／非法金额拒绝。已更新 contracts 与运行文档。没有真实账户、交易、AI 分享、定时任务、提交或推送；目标仍 active。

- P3.1 恢复与审计：上一轮属于 progress；检查当前 Git、进度及 legacy live enforcement／mandate／reconcile。旧 gate 使用 float 且无原子预占，保留其范围／到期／halt／拒绝未知规则，新 Decimal 风控在 SQLite BEGIN IMMEDIATE 内执行；未修改旧模块或解除 IBKR readonly。

- P3.1 RED→GREEN：test_orders.py 初始缺 orders 模块；实现独立 orders.db v1、不可变授权记录、意图唯一键、完整上下文与哈希审计链后 17 passed。未将 SnapshotStore v2 混作订单库。所有金额限额是测试 fixture，绝非用户策略或用户风控额度；生产账本拒绝 fixture 授权。

- P3.1 边界：仅建立软件核心内部接口，record_authorization 本身不证明获得用户同意；尚未提供 HTTP 授权入口、真实券商写适配、市场单／GTC、改单或成交释放。风险使用明确的 settledCash、净值、日亏损、持仓和报价上下文；P2 未提供这些全部可信字段前不能用于真实交易。

- P3.2a RED→GREEN：test_submission.py 初始缺 broker；实现先持久化唯一 submission attempt 再发送，SUBMITTING／ACKNOWLEDGED／UNKNOWN 均不重复调用。超时、非法 ACK 或中断保留全额占用；未决订单阻止同账户新意图。重启恢复显式调用 recover_inflight，不能在每个 DB 连接构造时误判其他正在运行的提交。

- P3.2a 失败可见：新增测试先报 lastError 缺失；现记录错误类型及审计事件，不存原始券商错误中的敏感文本。内部记录授权并不等于确认用户同意；没有真实授权创建入口，OrderExecutor 对 ibkr source 明确 BROKER_WRITE_DISABLED，fake 只在测试文件。

- P3 本轮验证：npm run test:ibkr:unit = 7 JS + 60 Python passed（新增 34 Python）；Starlette 弃用警告仍保留。前端／服务入口本轮未修改，未重复运行浏览器、构建或性能测试；先前 e2e 13 passed 不扩大为新交易界面验收。仅临时测试库，无运行中的测试进程；无提交／推送。

- P3.2b RED→GREEN：新增事件测试初始缺 reconcile；实现持久回报、成交与手续费版本、显式更正链、撤单排队和账户证明。中途修正审计参数 kind 重名；更正测试误复用不可变 snapshotId，改为每次不同的工程快照 ID，保留冲突保护。

- P3.2b 数字与预占：回报按 mode/accountKey/ID 匹配本系统已有券商三类 ID，绝不按 symbol 接管外部订单；execId 去重，更正显式 replacesExecId，原成交不覆盖。总现金与已结算现金分开；只有成交量、手续费、现金、持仓以及一致事件 watermark 全部核对后才降低／释放预占。撤单请求不触发释放。真实券商 execId 更正语义尚未映射。

- P3.2b 安全缺陷测试：已确认旧快照在释放预占后曾可重复使用资金；补充失败测试并绑定最新账户证明后修复。无法解释的终态重新打开及同 execId 不同数字持久化账户 halt。部分过时累计状态不能将终态倒退。12 新增用例通过；全量 7 JS + 72 Python passed。

- P3.2b 当前证明基线为首个管理订单之前的已知现金和持仓，加本账本全部有效成交／手续费。存款、分红、外部成交等未解释变化会拒绝对账，不伪造差额。授权撤销／过期不阻断旧订单跟踪；只读证明不授予任何交易能力。订单库迁移至 v2，待补专门迁移验证。

- P3.2b 补充：冲突检查与持久 halt 保持同一个 SQLite 写锁，避免错误到暂停之间插入新预占。内部 cancel 目前只是持久化请求排队，未接券商发送，不能说撤单链路完成。UNKNOWN 缺少提交前保存的券商身份时仍不自动关联外部订单，下一步补身份映射。

- P3 风控外部占用 RED→GREEN：新测试先因缺 externalOrders/openOrdersComplete 失败；增加显式完整性标识（默认 false）及外部订单风险字段。CANCEL_PENDING 仍计算买入现金／敞口与卖出股数；未知剩余量、MKT 无保护价格、非 STK／USD／乘数 1 等均拒绝，不默认零风险。全量 7 JS + 74 Python passed。

- 订单库迁移验证：test_order_migration.py 手工建立真实 v1 表结构和 UNKNOWN 工程订单，升级 v2 后意图哈希、占用、状态均保留，重复意图不重发，新意图仍被阻止；SQLite integrity_check=ok。与事件测试一起 13 passed。本批无前端修改、真实账户连接、订单、AI 分享或提交／推送。

- 本轮最终全量：npm run test:ibkr:unit = 7 JS + 75 Python passed；保留 1 条 Starlette/httpx 弃用警告。新增事件对账 12 项、外部风险 2 项、迁移 1 项。没有运行中的本任务验证进程；目标继续 active，P3.2c 待开发，真实核对仍 BLOCKED。

- P3.2c RED→GREEN：身份测试初始缺 identity.py；新增 BrokerSession、BrokerIdentity、SubmissionCommand。broker channel 与 mode 永久绑定；clientId 下的 orderId 用事务共享序列，取持久下一号与 SDK 下界的较大值；orderRef 随机生成，不含账户信息。身份与唯一 attempt 同事务落盘后才允许 fixture transport 发送。

- P3.2c SDK 证据：本机 ib_async.placeOrder 先发送后创建本地 PendingSubmit，不能把返回 Trade 当券商 ACK。新 ACK 必须匹配预分配 orderId/clientId，permId 唯一归属；错误 ACK 留 UNKNOWN 和原身份。未调用真实 SDK 写方法。

- P3.2c UNKNOWN 恢复：只读证据需准确匹配账户／模式／channel／orderRef／orderId／clientId 及合约、方向、数量、类型、价格和 TIF，再绑定 permId。只恢复归属并保持对账冻结，不释放资金、不重发。v1/v2 无预留身份的 UNKNOWN 不猜测迁移。订单库 v3，原 v1 迁移测试已验证可直接升级到 v3。

- P3.2c 最新全量：7 JS + 85 Python passed；一次语法换行错误已修正并通过全量。未运行浏览器或真实账户测试；真实写 gate 仍关闭。

- P3.2d RED→GREEN：撤单测试初始缺 executor.cancel；实现 CancellationCommand、发送前持久化、独立 cancelState。成功本地返回仅 REQUESTED，券商 CANCELLED 才 ACKNOWLEDGED，先 FILLED 则 TOO_LATE；不能靠 SDK 本地返回释放预占。

- 撤单超时／中断保持 UNKNOWN 和对账要求；相同或换 requestId 均不会自动再次发送。同一 broker channel、账户、模式、clientId 和已管理身份必须一致，外部订单及真实 source 仍拒绝。正式撤单入口的用户确认尚未接 UI/API，测试只用工程 fake。

- 本轮最终：npm run test:ibkr:unit = 7 JS + 90 Python passed（身份 10、撤单 5 新增）；Starlette/httpx 警告保留。未重复运行浏览器、构建或性能测试；无本任务后台进程、真实连接、真实订单、AI 分享、提交或推送。长期目标仍 active。

- P3.2e RED→GREEN：改单测试初始缺 amendments 模块；新增独立 amend_order 授权用途、手动确认哈希（含订单版本与账户快照）、不可变改单记录和 activeIntent。原始 intent/bodyHash 不变，券商 orderId/clientId/permId/orderRef 不变，不执行撤重下。订单库 v4 增加改单表，旧版升级测试仍通过。

- 改单预占：计算新条款尚未成交数量，在同一事务保留新旧风险较大值；预览后新增成交需重新对账，撤权／过期需重新确认。已有成交不重复计入剩余预占；改单也计入账户命令频次。降低数量／价格在本地发送返回、回报到达时都不释放，只有新条款精确匹配和账户核对后才降低。

- 改单生命周期：PERSISTED→SUBMITTING→SENT 只表示发送，精确 ReadOrderEvidence 才将版本推进为 ACKNOWLEDGED；超时／中断 UNKNOWN，保留占用且不重发；只允许放弃未尝试发送的本地预览。真实拒单和复杂终态竞态仍需 SDK 事件映射。9 项改单测试通过；最新已运行全量为 7 JS + 97 Python，另 2 项风险边界已单独通过。生产 gate 未更改。

- P3.2f RED→GREEN：SDK 编码测试初始缺 order_codec；实现纯转换函数，使用已解析 conId／合约规则和明确账户绑定。native Order 数量／价格保留 Decimal，身份保持一致，首期 DAY/LMT/outsideRth=False。新增失败测试发现 GTC 曾被静默写成 DAY，已改为明确拒绝不支持策略；零 tick 同样拒绝，不改写用户意图。

- SDK 离线验证：在 pytest-socket 禁用网络下使用实际 IB.placeOrder 和 Client.placeOrder，但 send 被测试截获；返回 Trade 是 PendingSubmit/permId=0，BrokerAck 验证拒绝。纯编码器本身无连接或发送方法；生产没有调用这些编码命令。

- 恢复缺陷 RED→GREEN：用 SQLite backup 捕获改单和撤单同时 SUBMITTING 的真实测试状态，恢复先前会把取消状态覆盖回 SUBMITTING；现合并状态后一次写回，两项均 UNKNOWN，保留 801 工程预占并要求对账。未使用真实账户或真实金额。

- 本轮最终验证：npm run test:ibkr:unit = 7 JS + 104 Python passed；Starlette/httpx 警告保留。新增 10 改单及 4 SDK 编码测试。运行文档／契约已更新，尚未新增订单网页、执行真实交易、AI 分享、定时任务、提交或推送；目标仍 active。

- P3.2g 后端预览 RED→GREEN：test_reviews.py 初始因 reviews 模块不存在而收集失败；新增浏览器不可提供账户余额、行情、风控或授权字段的 DraftOrder 严格契约。服务端可信 source 同时提供账户／行情快照和明确范围；缺失时直接 MISSING_QUOTE_AND_RISK_PROFILE，不用 fixture 顶替。

- 预览使用与提交相同的 Decimal 风控和账本全账户占用，但不写授权、订单或订单审计。确认必须显式动作、相同未过期 bodyHash，并重新读取完全一致的来源快照；随后在一个 SQLite 事务写入人工精确意图授权、预占和预览确认。重复确认只返回同一 PERSISTED 记录；任何失败整体回滚。此处 PERSISTED 仅为本地意图，不调用 broker.py／SDK，也不构成 paper 或 live 交易授权。

- 订单库 v5 新增 order_previews；v1 迁移回归已改为同时验证原 UNKNOWN 订单／601 工程占用保留及新表存在。首次全量仅旧版本号断言 4≠5 失败，修正测试目标后 `npm run test:ibkr:unit` = 7 JS + 111 Python passed；1 条 Starlette/httpx 弃用警告保留，git diff --check exit 0。API 与网页确认流程仍在本阶段下一步；无真实连接、订单、提交或推送。

- P3.2g API RED→GREEN：3 项新 API 测试初始因 create_app 不接受 order_reviews 失败。现只有配置了服务端可信 source 时开放 preview／confirm 两个 POST；session 仍返回 writesEnabled=false，确认响应只能是本地 PERSISTED 且 orderId/permId 为空。余额、风控和自签授权字段由 Pydantic extra=forbid 返回 422；PUT、未知写路径、跨站 Origin 保持 403。

- 同源代理 RED→GREEN：新增测试先因 allowedTerminalHttpRequest 不存在失败。代理现精确允许 session/snapshot 两个 GET 与 preview/confirm 两个 POST，只接受 JSON 且限制 16 KiB；token 仍仅由服务端代理读取，不进浏览器。TypeScript 编译通过。

- 订单页面 RED→GREEN：先为返回预览契约增加失败测试；再在既有中栏“订单”页加入首期 paper 整股 DAY 限价票据，展示 conId、报价、快照、现金／敞口预占、过期时间与 testData 警示，单独勾选后才能本地确认。live 直接显示写入关闭；未连接、stale、无合约或非实时报价均禁用。浏览器初次测试误将顶栏按钮当 tab 导致超时，修正测试角色；第二次因 fixture 故意无报价而禁用，显式加入 fixture.quote 后通过，没有放松产品拒绝逻辑。

- P3.2g 本批最终：`npm run test:ibkr:unit` = 9 JS + 114 Python passed；`npm run test:ibkr:e2e` = 15 passed；`npx tsc -b --pretty false`、`npx vite build`、`git diff --check` exit 0。构建仍报告 >500 kB 既有 chunk 警告；Starlette/httpx 弃用警告保留。生产启动没有风险 profile/source，因此订单审查保持禁用，不能宣称真实 paper 可下单；无真实连接、订单、提交或推送。

- P4 复用审计：现有 `backtest/engines/base.py` 的 loader 分层、下一根 bar 对齐概念、Runner 子进程超时和 run-card 哈希可复用；其资金／价格／费用使用 float，期末强平不走统一滑点路径，无显式拆股分红事件账本，任意 signal_engine 可读取完整未来 DataFrame，因此不作为终端 Decimal 金标准账本。证据与边界记录在 `docs/design/ibkr/backtest-engine-reuse.md`。

- P4 策略目录 RED→GREEN：test_strategy.py 初始因 ibkr_terminal.strategy 不存在而收集失败。新增独立 SQLite 不可变版本目录：策略定义内容哈希，同 ID+版本同内容幂等、异内容拒绝，新版本独立；fixture 必须使用 example: 且生产默认拒绝，user 必须使用 user:，规则/参数为严格声明式字符串，不执行任意代码。7 项测试通过；工程示例不计用户策略验收。

- P4 Decimal 金标准 RED→GREEN：test_backtests.py 初始因 backtests 模块不存在而收集失败。新增纯 Decimal 事件账本；信号必须对应已知 bar 且仅在下一根 bar 开盘成为可执行，期末按最后收盘计价而不制造强平。费用、每股费与滑点分别累计；拆股先调整股数、分红再入现金、随后处理下一 bar 信号，全部形成明细事件。

- 金标准首次 6 项中唯一失败为规范化十进制 `2` 与测试预期 `2.0` 的表示差异，断言改为规范输出；随后补资金不足不产生虚假成交。最终 8 项覆盖无交易、手算买卖、拆股分红、缺失 OHLC／公司行动完整性、跨时区、bar 上限、策略哈希篡改及未验证多资产拒绝。首期明确只验证单资产，避免表面支持。全量 `npm run test:ibkr:unit` = 9 JS + 129 Python passed；警告保留。worker、持久产物、前端和用户策略验收仍未完成。

- P4 归档 RED→GREEN：test_backtest_archive.py 初始因 BacktestArchive 不存在而收集失败。归档在保存和每次读取时用原策略、配置、bars、信号重新执行并要求结果逐字段一致；runHash 主键不可变，跨重启恢复。完整包保留原始数据 source/dataVersion、策略定义、配置、信号、事件、日志与指标；四类摘要严格为 64 位十六进制。

- 归档 JSON/Markdown 使用 runHash 独立目录和临时文件替换；Markdown 列出策略／数据／配置／运行哈希及数据版本和来源，fixture 显示“工程测试数据；不是用户策略验收”。3 项归档测试通过，P4 定向 18 passed。统一 `npm run test:ibkr:unit` = 9 JS + 132 Python passed；1 条弃用警告保留；指定 8765/5187/5188/5189 无监听，`git diff --check` exit 0。worker、取消与 UI 尚未做。

- P4 worker RED→GREEN：test_workers.py 初始因 workers 模块不存在而收集失败。新增持久任务表和受限 ThreadPoolExecutor，只运行声明式 Decimal 引擎，不导入用户代码。submit 立即返回；执行线程与调用线程不同；输入 JSON 字节、bar 数、worker 数及逐 bar 总时限受限。取消协作检查贯穿首次计算和归档重放，不发布半成品；重启将 PENDING/RUNNING/CANCEL_REQUESTED 改为 INTERRUPTED/PROCESS_RESTARTED，不自动重跑。4 项通过，P4 定向 22 passed。

- P4 API RED→GREEN：3 项测试初始因 create_app 无策略／归档／任务参数及路由而失败。新增只读策略、回测和任务 GET，以及只取消服务端已知任务的 POST；浏览器提供 bars 或自签策略的 POST /backtests 保持 403。生产启动只创建空的非 fixture 目录和 worker，不自动创建任务。代理白名单只扩展对应 GET 和严格 backtest:<32 hex>/cancel；无一般写入口。

- P4 UI RED→GREEN：新增 backtestClient 严格校验来源标签、Decimal 字符串、状态及 64 位哈希；现有中栏“分析”页显示用户策略／数据门槛、不可变版本、任务、工程标记、结果指标和四类可复现摘要。缺用户策略或生产数据时运行按钮禁用；账户同步、订单和新闻请求不参与此组件。2 项新增浏览器用例验证诚实空态、工程结果、证据展开及已知任务取消。

- P4 本批最终：`npm run test:ibkr:unit` = 10 JS + 139 Python passed；`npm run test:ibkr:e2e` = 17 passed；`npx tsc -b --pretty false`、`npx vite build`、`git diff --check` exit 0。Starlette/httpx 与 >500 kB chunk 警告保留。没有可信生产数据集、用户策略或真实 paper 授权，因此未开放浏览器启动回测，也不能标记 P4 用户验收完成。

- P6 风险分析 RED→GREEN：`test_analytics.py` 初始因 `ibkr_terminal.analytics` 不存在而收集失败。新增纯本地、无模型／网络的 Decimal 分析：总／净敞口、最大持仓权重、维持保证金使用率和逐币种现金；每个可用值带 snapshot/source/observedAt 证据。断线、陈旧、多币种缺 FX、缺净值及未知订单数量均明确标记 unavailable/stale，不补零、不合并伪基准币总额。4 项通过。

- P6 本地报告 RED→GREEN：`test_reports.py` 初始因 `ibkr_terminal.reports` 不存在而收集失败。按 PDF 技能完成一次产物操作标记后，新增同一快照生成 JSON、Markdown、自包含 HTML 和 A4 PDF；所有格式包含报告哈希、快照哈希、来源证据和“数据缺失”语义，HTML 对不可信来源转义。PDF 使用嵌入的微软雅黑 CJK 字体、页眉页脚、证据表和页码；不调用模型、不上传账户数据。

- P6 工程报告证据：由 `tests/ibkr/fixtures/risk-report-snapshot.json` 明确标记的 `paper:engineering-report` fixture 生成，绝非真实 paper 账户。最终目录为 `output/pdf/ibkr-terminal-engineering-risk-report/4d4e6d359e31fb11a210e9baafd051118abc2d3644f9737e3e724f8ee6684409/`；PDF SHA256 `ACF15CE0381DA034FFD59DB6395BA33196957512AC310C325D9D0A9186E8C03D`。Poppler 渲染和目视检查确认 1 页 A4、无裁切／重叠；pypdf 可提取中文标题、来源和报告哈希；截图归档为 `docs/design/ibkr/screenshots/account-risk-report-engineering.png`。

- P6 当前全量：`npm run test:ibkr:unit` = 10 JS + 146 Python passed，保留 1 条 Starlette/httpx 弃用警告；`git diff --check` exit 0，仅显示工作区 LF→CRLF 提示。AI 账户分享仍为默认关闭，尚未配置模型或预算，也未做任何外发；下一步实现授权边界和只读页面接入。

- P6 AI 授权 RED→GREEN：`test_intelligence.py` 初始因 `intelligence` 模块不存在而收集失败。新增本地 SQLite 明示授权：账户/模式、provider/model、字段集合、字符与请求预算、开始/到期和撤销均固定；同 ID 异内容拒绝，消费计数原子更新。无授权默认关闭；过期、撤销、跨账户、未来/陈旧快照、fixture 未单独允许、来源不一致和预算耗尽均拒绝。

- AI 上下文只生成待发送包，不含调用器或交易工具；账户 key 变为哈希别名，持仓行去除账户字段，订单永不在允许字段中。新闻/宏观/微观统一标记 `untrusted-evidence` 与 `instructionsAreData=true`，恶意“下实盘单”文本只保留为证据内容，能力列表为空。6 项授权/注入测试通过；生产未提供创建授权的浏览器接口，也没有模型调用。

- P6 API/UI RED→GREEN：风险分析、AI 状态、报告创建/列表/固定格式下载均按当前 session 的 mode/accountKey 复核；报告路径只接受 64 位哈希和 json/markdown/html/pdf，代理现可安全转发 PDF 二进制。`server/ibkrAccountContext.ts` 与 `ibkrAccountReports.ts` 将账户上下文和本地报告边界从通用代理中分离；没有 AI grant POST。3 项 API 测试通过。

- 右栏现在在有效快照上独立加载确定性风险、AI 状态和报告列表；展示总/净敞口、最大仓位与保证金使用，波动/相关性不足时仍拒绝给健康分。可显式生成本地报告并下载四格式，工程 fixture 标记保留；账户/快照身份不一致则客户端再拒绝。新浏览器用例先因旧占位内容失败，最小实现后通过，完整 e2e 18/18。

- P6 最终回归：首次全量单测因 Node ESM 无扩展导入失败，改用 `.ts` 显式扩展并在仅 `noEmit` 的 node tsconfig 开启 `allowImportingTsExtensions`；随后 `npm run test:ibkr:unit` = 10 JS + 155 Python passed，`npx tsc -b --pretty false` passed，`npx vite build` passed，`git diff --check` exit 0。构建仍报告既有大 chunk 警告；Starlette/httpx 警告保留。无真实账户数据外发、模型调用、订单、提交或推送。

- P1.2 历史行情 RED→GREEN：新增 account/mode/snapshot/conId/period 绑定、严格递增 Decimal K 线、来源/asOf/hash 和 stale 缓存；生产拒绝 fixture。SDK 仅调用 `reqHistoricalDataAsync`，首期 USD STK/ETF、SMART、TRADES、RTH；账户快照读取前后必须一致。前端 lightweight-charts 独立加载，10,000 根工程数据用例通过；无权限/空/陈旧/错误不以样本回退。

- P5 离线运行 RED→GREEN：新增独立持久 runtime。激活与交易授权分离；浏览器仅能查看和停止新增信号，没有激活/恢复入口。重复信号幂等，内容冲突、序列缺口、重启、陈旧行情、账户或授权不符均 fail-closed；共享 `OrderLedger.reserve`，只产出本地 PERSISTED 意图，不调用 broker transport。6 runtime + 1 API 与网页测试通过；真实用户策略和两个 paper 时段仍 BLOCKED。

- P6 新闻证据 RED→GREEN：浏览器用例先看到“新闻来源等待接入”而失败；复用 `/api/news-feed` 后显示来源、发布时间、抓取时间、stale 与安全 HTTP(S) 原文链接。`javascript:` 不生成链接，React 文本渲染；“我的持仓”按当前账户标的筛选。宏观未完成统计口径/账户映射、微观无数据权限时保持诚实空态；AI 开关仍写明尚未分享。截图已目视检查。

- P8 性能短跑：生产 build、Chrome 152.0.7977.82、1440×1000、50 持仓/500 订单/10,000 K 线 fixture：LCP 1284ms，图表就绪 3560.5ms，30 次交互 p95 69.08ms，heap 54,964,076 bytes，40 requests，无控制台错误。headless rAF 233.39 仅证明未见持续主线程阻塞，不当作显示器 60fps。60 分钟同一工具仍运行。

- P8 维护 RED→GREEN：backup/validate/restore 测试先暴露 Windows SQLite 句柄未关闭，修复后 3 项通过。CLI 实际演练复制 1 SQLite+1 报告，manifest 哈希验证、integrity_check=ok、内容恢复一致、session.token 未复制。清理命令被本地自动策略拒绝，已忽略的 `.sparkflow/ibkr-maintenance-drill` 暂保留，不隐瞒。live readiness runbook 已记录 SDK、登录/MFA、账户/行情核对、授权矩阵、UNKNOWN、备份恢复和人工应急。

- P6 报告任务 RED→GREEN：初始测试因 `report_jobs` 模块缺失失败；新增独立 SQLite+受限线程任务，提交立即返回，running 可取消，取消后暂存目录不发布，重启把未完成任务标 INTERRUPTED 且不重放。账户/mode/snapshot 固定，代理只允许 32 位任务 ID 的 GET/cancel；没有 retry 或交易调用。网页轮询任务且可取消，账户切换中止旧请求。4 新 Python 与 1 浏览器用例通过。

- P1 搜索 RED→GREEN：Ctrl+K 搜索用例先找不到新闻链接；现将当前账户 conId 合约结果与来源新闻分区，新闻由独立请求加载并保留安全链接/来源/发布时间；旧账户数据仍由 snapshot 隔离。恶意 HTML 标题作为文本呈现，无 img 注入。

- P4 结果补齐 RED→GREEN：手算用例先因缺 equityCurve 失败；加入每根 bar 的现金/市值/权益/回撤，全部进入 runHash 和归档重放。同标的持有基准按首根收盘归一化并应用未复权拆股/分红；换手=成交金额/初始资金；至少两个区间收益才输出 `period-return-v1` 样本波动和风险调整值，否则明确样本不足。首次定向回归因循环小数超过 18 位契约出现 10 失败，改为 Decimal 18 位规范化后 P4 15 passed；网页展示可访问权益曲线及口径指标。

- P1/P6 宏观与可访问性 RED→GREEN：宏观标签初始仍显示未接入；现独立读取既有 global macro section，展示真实源链接、live/delayed/unavailable、源时间与源提供的统计期，缺 period 明示“统计期未单列”，且不自动推导账户结论。另验证所有可见控件有名称、搜索焦点边框可见，核心 text/dim/accent 三组颜色分别达到预设 WCAG 7/4.5/4.5 阈值。微观仍因无数据源诚实未接入。

- 临时验证产物：PDF 目视检查渲染图仍位于已忽略的 `tmp/pdfs/ibkr-risk-report/page-1.png`；与 maintenance drill 一样，递归清理命令被本地自动策略拒绝后未改用宽泛删除命令。两者都不在 Git 变更中。

- 本批完整回归：首次 unit 因策略 stop POST 漏入代理白名单而 9/10 JS；修复为复用窄范围 account-context gate。加入报告任务/搜索后最新 `npm run test:ibkr:unit` = 10 JS + 176 Python passed；`npm run test:ibkr:e2e` = 23 passed；`npx tsc -b --pretty false`、`npx vite build`、`git diff --check` passed。`test:macro-release`、`test:market-cache`、`test:isolated-market-data` 全部 passed。保留 Starlette/httpx 弃用警告和 >500kB chunk 警告；没有真实连接、订单、账户数据外发、提交或推送。

- P8 旧构建 60 分钟基线完成并归档为 `docs/design/ibkr/performance/soak-60m-pre-report-ui.json`：LCP 1112ms、图表 2009.73ms、点击 p95 76.30ms、headless rAF 209.47、120 个样本、堆结束较首样本 +559,892 bytes／峰值 15,147,796 bytes、请求恒定 40、控制台错误 0。DOM 节点在切换 25 行分页表格时 1506–4821 周期变化，末值 3358，并非单调常驻；该结果通过当时阈值，但不含后续报告／策略界面和事件延迟测量，因此只作基线。

- P4 共享信号 RED→GREEN：新增结构化 SMA 交叉定义、固定整股只多仓位、成本、最大仓位和版本说明；任意代码、future DataFrame、窗口倒置、分数股、做空和超限目标均拒绝。`signals.py` 只读取截至当前的闭合收盘序列；回测与 paper runtime 适配从同一目标事件构建。27 个后端定向测试、2 个草稿单元测试和浏览器草稿用例通过；草稿只在浏览器生成 JSON，不保存、不授权、不激活。

- P1 状态／P7 授权：`ui-state-matrix.md` 逐区记录 loading/empty/error/stale/permission-required；新增账户过期与历史行情权限浏览器测试。设置页授权矩阵将只读查看、人工订单、自动策略和 AI 分享分开，live 缺少账户／品种／版本／限额／期限时保持关闭。

- P6 证据报告 RED→GREEN：报告请求可带最多 100 条严格 HttpUrl 证据，测试来源必须与快照一致，holding 关联 conId 必须存在；新闻只以精确代码文本关联，宏观标为 `ACCOUNT_CONTEXT_NOT_CAUSAL`，微观无权限写 `MICRO_PERMISSION_REQUIRED`。证据和缺口进入报告哈希、任务持久输入及 JSON/Markdown/HTML/PDF。非法 URL、串来源、未知 conId 均测试拒绝；带两条来源的 PDF 为 1 页 A4、无裁切且含 2 个链接注释。

- 冻结候选最终回归：`npm run test:ibkr:unit` = 14 JS + 185 Python passed；`npm run test:ibkr:e2e` = 28 passed；`npm run test:ibkr:stream` 3 心跳通过并修复 Windows WAL 延迟释放的有限重试；`npx tsc -b --pretty false`、`npx vite build`、`git diff --check` passed。`test:macro-release`、`test:market-cache`、`test:isolated-market-data` passed。短性能为 LCP 848ms、图表 1754.16ms、事件→页面 p95 4.57ms、点击 p95 56.30ms、无失败响应/控制台错误；结果保存为 `event-latency-current-build.json`。当前构建 60 分钟 session 13136 已启动。

- P8 连接/队列 RED→GREEN：中止不含连接/队列指标的 session 13136，未拿它冒充最终验收。性能页仅在测试预置诊断对象存在时记录消息、应用 patch、重同步、活动/峰值 WebSocket 和待处理/峰值队列；短测持续负载下 38/38 patch、41 消息、WS 1/1、队列 0/1、重同步 0，LCP 928ms、事件→页面 p95 4.55ms、点击 p95 54.19ms，passed。结果覆盖 `event-latency-current-build.json`；最终 60 分钟 session 42745 运行中。

- 报告安全补测 RED→GREEN：既有恶意来源 HTML 测试扩展到 Markdown 后先失败；新增 `&<>|` 与换行转义后 5 项报告测试通过。外部文本不会破坏导出表格或成为原始 HTML。

- 契约漂移核对：按主计划逐项审计时确认顶栏搜索已有“当前账户合约／有来源新闻”分组和浏览器测试；“历史”标签诚实保留为非完整 IBKR 查询窗口，未把内部账本或样本冒充券商历史。修正 `contracts.md` 的过期表述为 orders.db v5、本地预览／确认窄 POST 及仍禁用真实 broker transport；`rg` 复核无旧描述，`git diff --check` passed。下一步仍为 session 42745 长测结果与趋势判定；真实订单历史及写入待获授权 paper 核对。

- P6 报告章节 RED→GREEN：新测试先因缺 `reportSchemaVersion` 失败；实现 schema v2，把摘要、账户概况、收益归因、建议及来源与限制写入 JSON 内容哈希和 Markdown/HTML/PDF。当前快照不含期初权益、净现金流及分段收益时明确不计算归因；不生成投资策略或额度。工程样本报告 `5bff1116…cb5af34` 为 2 页 A4、99,378 bytes、SHA256 `47AC568AD755E302264B9E236515E65FC7A67446B84CC30886DCA3AB781B923F`；文本提取 1,498 字符含全部章节。另用显式 news/macro fixture 验证 2 个 PDF 链接注释与两页无裁切；均非账户事实。随后真实旧产物检查发现 pre-evidence 格式一度 `REPORT_HASH_MISMATCH`，新增失败测试并按 pre-evidence/v1/v2 三种原始公式校验；16 项报告／任务／API 测试 passed，三代磁盘报告均可读且不重写，保留 1 条已知弃用警告。

- P8 候选构建身份：`session-42745-build-manifest.json` 固化 48 个相关前端、代理与 `dist` 文件的路径、字节数和 SHA-256；清单自身 SHA256 `B68AC4560D8D45D8E1533836E25BA96F054EEDCB51CDA3FBEA1FE9F034D5DE6A`，主资产 `index-CeO1y2zX.js` / `index-DAyUKd8u.css`。报告后端改动后复核 48/48 unchanged，长测仍代表同一冻结候选。

- P8 最终长测：session 42745 完整 60 分钟、120 个样本，`passed=true`；LCP 876ms、图表 1740.65ms、事件→页面 p95 4.42ms、点击 p95 58.08ms，headless rAF 240.09 只作卡顿探针。3594/3594 patch 应用，4494 stream messages、重同步 0、活动/峰值 WS 1/1、队列 0/1；请求首尾/峰值均 42，documents 恒为 1，DOM 在 1506/2043/2432/2969/3699 五档随分页循环。启动 heap 225.92MB 随 GC 回落；稳定段 15.33–17.76MB，前后半中位数 16.81/17.09MB，线性趋势约 +0.64MB/h，未见无界增长。结果 `soak-60m-current-build.json` 52,403 bytes，SHA256 `81DCA4F6AADF1314FD382C3B6ACE302F666DF067D5DD9350CE75C8E7EF7D6462`；结束复核构建 48/48 unchanged，5190 及候选子进程已退出。

- P8 最终回归：`npm run test:ibkr:unit` = 14 JS + 186 Python passed（1 条 Starlette/httpx 弃用警告）；`npm run test:ibkr:e2e` = 28 passed；`npm run test:ibkr:stream` 3 心跳、token 403、无 broker；`npx tsc -b --pretty false` 与 `npx vite build` passed，构建仍有 >500kB 警告。`test:macro-release`、`test:market-cache`、`test:isolated-market-data` 通过；复用用户已运行的本工作区 5180 服务执行 `test:macro-cards`，六卡强制刷新 3.378s、全部 stale=false。未终止用户进程，未连接 IBKR，未发订单。

- 2026-09-06 本轮真实 paper 核对：重启并清理重复账户服务后，Gateway `127.0.0.1:4002`、账户服务 `127.0.0.1:8765`、网页 `127.0.0.1:5180` 可用；代理 session/snapshot 返回 `source=ibkr`、`testData=false`、`connection=connected`、`state=empty`、指定账户 `DU***372`、持仓/挂单/成交均为 0（本次查询窗口）。SPY 合约查询返回 conId `756733`；`market-data` 的 `1D`、`5D`、`1M` 均返回 `state=ready`、`source=ibkr.historicalData` 的真实 K 线。实时报价请求先记录 `IBKR_10089`（API 市场数据需额外订阅），随后延迟 feed 返回 `state=delayed`、`last=769.45`、`close=773.17`、`detail=IBKR_10167`；没有把延迟或收盘价当成实时成交证据。`test_market_watch.py` 新增权限错误归属用例后 6 passed；真实 paper 下单/撤单未发送，仍需用户精确范围与实时成交报价/PnL 条件。

- 2026-09-06 13:19（本机只读核对）: 用户开启实盘 Gateway 后，`127.0.0.1:4001` 可连接；使用独立 `clientId=79/80` 的只读连接发现 1 个已登录账户，并通过 `reqAccountUpdates` 读取到 12 个股票持仓。账户号只在本机内存和受限 API 调用中使用，未写入仓库、未在日志中输出完整值；未发送订单。当前账户服务绑定文件仍只有 `paper:primary`，因此网页 session 尚未注册实盘账户；本次结果仅证明实盘只读 API 可读，后续如需网页展示需在本机私有绑定中补充 `live` 条目。

- 2026-09-06 本轮实盘页面接入：在受限本机 `.sparkflow/ibkr-terminal/bindings.json` 增加 `live:primary`，使用实盘 Gateway `127.0.0.1:4001`、独立 `clientId=79`、`readonly=true`；完整账户号不进入 Git 或用户可见输出。重启账户服务后 `/api/ibkr-terminal/session` 返回 paper/live 两个只读账户且 `writesEnabled=false`；`/api/ibkr-terminal/snapshot?mode=live&accountKey=live%3Aprimary` 返回 `source=ibkr`、`testData=false`、`connection=connected`、`state=ready`、12 个真实持仓。缺口仍为 `quotes`、券商窗口外历史成交和 `unrealizedPnl`；网页默认仍为模拟盘，需在顶栏切换“实盘只读”。

- 2026-09-06 K 线展示增强：现有 `PriceChart` 保留 IBKR 历史 OHLC 数据源，增加 MA5/MA10/MA20 线、成交量柱、十字光标中文 OHLC/涨跌额/涨跌幅/成交量详情、数据源口径标识和缺失字段说明；成交额与换手率因 IBKR 历史响应未提供，显示 `—`，没有用估算值冒充真实字段。新增浏览器断言验证均线图例与悬浮详情；`npm run test:ibkr:unit` = 16 JS + 275 Python passed，`npm run test:ibkr:e2e` = 31 passed，`npx tsc -b --pretty false`、`npx vite build`、`git diff --check` passed。构建保留既有 >500 kB chunk 警告和 Starlette/httpx 弃用警告。


### 2026-09-07 持仓动态 Logo — VERIFIED（展示范围）

- 文件：`server/ibkrCompanyLogos.ts`、`server/ibkrWorkbench.ts`、`vite.config.ts`、`src/components/ibkr/HoldingLogo.tsx`、`AccountWorkbench.tsx`、`AccountWorkbench.css`；保留本地既有紧凑样式调整。
- 实现：复用热力图本地 Logo；新增股票按代码、币种和交易场所查询 TradingView，ETF 可使用发行方 Logo。外部图片经本机后端和现有代理下载；成功缓存 24 小时，未匹配缓存 60 秒；并发请求合并。账户刷新新增持仓会自动加载，失败保留字母且不随每次账户轮询重试。无账户标识、数量、金额或凭证传到 Logo 来源。
- RED：新增测试首次运行因 Logo 模块不存在失败；GREEN：`npm run test:ibkr:workbench` 41/41；`npx tsc -b --pretty false` 通过。`npx playwright test --config playwright.ibkr.config.ts workbench.spec.ts --grep 'holding logo|populated report and risk layouts'` 6/6；图片代理完成后重跑 `--grep 'holding logo'` 2/2。离线工程样本截图 `tmp/workbench-qa/holding-logos.png` 已检查。
- 真实本机 GET 验证：AAPL 本地图片 HTTP 200；QQQ 动态解析 Invesco，SVG HTTP 200、735 bytes；VTI 动态解析 Vanguard，SVG HTTP 200、2264 bytes。原直连 CDN 超时，已通过后端代理解决。
- 限制：当前覆盖美股及 ETF、港股、A 股；未知市场、歧义代码、无 Logo 或来源中断保留字母。Logo 是展示资料，不是账户或行情证据。外部未知标的不能保证全覆盖；刷新页面可在失败缓存到期后重试。未下单、未变更授权、未提交推送。
- 下一步：按用户反馈调整展示；这项验收不代表完整交易终端目标完成。既有研究任务测试文案失败见上一阶段说明，本次未修改该逻辑。


### 2026-09-07 账户总览补充与参考布局 — VERIFIED（本次展示范围）

- 参考：`F:/下载/ibkr-dashboard-redesign.html` 原样归档至 `docs/design/ibkr/ibkr-dashboard-redesign.reference.html`，两份 SHA256 均为 `5E3465F07F18F50447AFB3C7CC1017B9197FF49E3BF1A84A6B9E9AD76B83B2B9`。HTML 脚本、账户数值、新闻和 71/100 均只作参考，未作为生产事实执行或导入。
- 文件：新增 `src/components/ibkr/OverviewPanels.tsx` / `.css`、`src/lib/ibkr/overview.ts`；`AccountWorkbench.tsx` 接入主区、次区和资金区；`WorkbenchPanels.tsx` 转出资产表现组件。保留既有紧凑样式与动态 Logo。未修改宏观卡片、账户授权或订单代码。
- 功能：宽幅资产曲线、右侧刻度、净值／收益与周期切换、同区间基准与原波动率指标、月度 TWR 柱、收益摘要；右侧简报徽标、规则等级半环、组合结构／事件影响／行动条件与可跳转提醒。下方增加前五集中度、前六持仓分布、行业未知／ETF 分类、按币种浮盈浮亏排行、现金／购买力／维持保证金。分布与排行支持打开原持仓详情。
- 数据边界：月收益按相邻月界实际累计 TWR 复合计算，缺基点月份留空，最新月份标截止日；MWR 不做月度重基，本地净值不推算收益。跨币种估值缺失时整体集中度留空，盈亏按币种分别排行；未生成研究则显示账户事实与待办，不填示例事件或个人风险额度。半环只表达现有等级，不构造百分制分数。
- RED：新增 `tests/workbench/overview.test.mjs` 首次因模块不存在失败；实现后验证月界、TWR、入金隔离、MWR、无效数据、重复日期及跨币种。GREEN：`npm run test:ibkr:workbench` 44/44；`npx tsc -b --pretty false` 通过；`npx vite build` 通过（保留既有大 bundle 提示）；`git diff --check` 通过。
- 浏览器：`npx playwright test --config playwright.ibkr.config.ts workbench.spec.ts --grep-invert 'resumed older research'` 17/17，含 1920/1440/808/390 宽度、月收益数值、币种切换、无来源空态、持仓详情／研究跳转以及原授权／报告／Logo 回归。已知旧用例另外单独执行 `--grep 'resumed older research'` 仍失败：预期“持仓覆盖 1/2”，实际 UI 文案为“历史逐仓覆盖”；本次未删除或改写此用例，也未宣称全套通过。
- 本机真实页面只读检查：`http://127.0.0.1:5180/ibkr` 页面异常 0、横向溢出 false、真实月度收益图 1、总览 5 个 Logo 成功加载。截图 `tmp/workbench-qa/overview-live-redesign.png`（本地账户资料，未纳入 Git）已目视核验；工程截图 `overview-redesign-monthly.png`、各宽度 `overview-*.png`。
- 剩余限制：账户研究仍未发布完整报告，行业来源缺失继续显示“行业待核实”；历史不足的月份不补数。下一步按用户反馈调整；未提交或推送，本次不代表长期交易目标完成。


### 2026-09-07 总览全屏紧凑布局 — VERIFIED（1920×1080）

- 文件：`AccountWorkbench.tsx` 增加仅总览生效的密度类、研究状态组和下方模块容器；`OverviewPanels.css` 收紧桌面顶部、64px 指标卡、面板间距，将收益摘要／月收益并排及宽屏四个明细模块并排；`OverviewPanels.tsx` 的 SVG 根据实际宽高计算坐标，缩小图形仍保留刻度字号。
- 不通过 zoom、缩放整页、隐藏模块、裁切数据或固定高度滚动容器适配；研究详情可展开，完整 12 个持仓仍由“查看全部”进入。手机保持纵向排列。较窄／矮窗口、长报告或展开详情允许正常滚动。
- 真实页面验证：1920×1080，页面总高 1080px，无横向溢出；主要明细区底部约 964px，页脚底部约 1030px，全部主要模块同屏。1600×900 总高 1054px，仍需少量滚动，未宣称所有分辨率都能完整同屏；2560×1440 初检同屏。真实截图 `tmp/workbench-qa/dense-live-1920.png` 已目视检查（本地私有账户资料，未纳入 Git）。
- 验证：新增“full HD overview fits all summary modules while research is pending”浏览器用例检查 12 持仓／待研究／月收益下所有主要模块边界均在 1080px 内，且“查看全部”可显示 12 行。`npx playwright test --config playwright.ibkr.config.ts workbench.spec.ts --grep 'full HD overview|populated report and risk layouts|overview presents|workbench empty layout'` 10/10，通过 1920/1440/808/390 布局和数据交互回归；`npx tsc -b --pretty false`、`git diff --check` 通过。既有研究文案用例未在本步骤重复运行，上节失败记录仍有效。
- 下一步：按实际窗口使用反馈调整；未改账户／研究授权／订单逻辑，未提交推送。

### 2026-09-07 按绿色标注重排总览 — VERIFIED（本次布局范围）

- 用户参考：`codex-clipboard-0b270afe-851a-4f1f-9252-8e0bb35cddf5.png`。宽屏改为左上资产表现，左下依次为持仓、持仓分布、持仓盈亏排行、资金概况，右侧 AI 账户简报贯穿两行；绿色线条仅为布局标注。四个下方模块和简报底部对齐至页面底部 8px。
- 文件：`src/components/ibkr/AccountWorkbench.tsx` 新增总览布局容器；`OverviewPanels.css` 使用五列命名网格、窄侧栏纵向简报、矮屏图表高度适配。保留用户要求移除总览研究任务条、底部 AI 输入条与页脚的改动；研究任务和输入仍可在 AI 分析页访问。账户、行情、研究和交易逻辑未改。
- RED：扩展 `tests/ibkr/workbench.spec.ts` 的全屏几何断言，旧布局右侧简报与底部相差 486px 而失败。GREEN：`npx playwright test --config playwright.ibkr.config.ts workbench.spec.ts --grep 'full HD overview|layout|overview'` 11/11，含 1920/1440/808/390 布局与数据交互，以及 1920×1080 / 1600×900 同屏断言；`npx tsc -b --pretty false` 和 `git diff --check` 通过。
- 本机页面只读验证：1920×1080 页面高 1080、宽 1920，右栏及底部四卡底边 1072；1600×900 页面高 900、宽 1600，持仓表格可视／滚动宽均为 374px，无横向溢出。截图 `tmp/workbench-qa/green-layout-live-1920.png`、`green-layout-live-1600.png` 已检查；账户图片仅保存在本地忽略目录。
- 限制：总览持仓仍为前五条，通过“查看全部”查看全部持仓；小屏、长报告、展开详情可正常滚动。不宣称任意数据量和屏幕均同屏。既有研究任务测试本次未运行，先前文案失败仍未解决；任务条已按用户要求移至其他页，其旧总览定位也需随研究流程维护。未提交推送。

### 2026-09-07 全屏按空间补充实际持仓 — VERIFIED（自适应列表范围）

- 文件：新增 `src/components/ibkr/useAdaptiveRows.ts`，`AccountWorkbench.tsx`、`OverviewPanels.tsx` 接入实际卡片高度与行高测量；`tests/ibkr/workbench.spec.ts` 补充窗口伸缩和账户更新回归。
- 行为：宽屏持仓、持仓分布、盈亏排行不再固定为 5／6／3+3 行。ResizeObserver 和窗口 resize 触发测量，按剩余空间添加真实记录，缩小窗口后减行；盈亏仍按币种、正负分组和原顺序展示。行数以实际记录数为上限，分布颜色循环使用原配色，文案反映实际显示数量。总览不继承完整持仓页的搜索过滤；全部持仓入口保留。
- RED：扩展全屏测试，2560×1440 预期 12 行、旧实现只有 5 行，失败。GREEN：`npx playwright test --config playwright.ibkr.config.ts workbench.spec.ts --grep 'full HD overview|layout|overview'` 12/12；覆盖两次放大／缩小、三个列表全部 12 条、2→8→0 条账户自动轮询更新、窄屏和现有数据交互。空态过滤修正后再跑 `--grep 'adaptive overview'` 1/1。`npx tsc -b --pretty false`、`npx vite build` 通过（保留既有大 chunk 提示）。
- 本机真实页面只读核验：2560×1440 三个列表各 12 行；1920×1080 为持仓 7、分布 9、盈亏 9；1600×900 为 5／6／6；返回 2560×1440 恢复各 12。以上页面高宽均等于视口，无页面异常，最后一行及说明均在卡片边界内。截图 `tmp/workbench-qa/adaptive-live-2560.png` 等已目视检查，只保存在本机忽略目录。
- 限制：全部真实记录已展示后保留剩余空白；盈亏为零、缺失或其他币种的持仓不强行放入当前浮盈／浮亏分组。小屏保留紧凑摘要并可进入全部持仓。未修改账户／交易权限，未下单，未提交推送；既有研究任务测试未在本步运行，之前失败记录仍有效。

### 2026-09-07 资产曲线半透明悬浮详情 — VERIFIED（展示范围）

- 文件：`src/components/ibkr/OverviewPanels.tsx`、`OverviewPanels.css`、`tests/ibkr/workbench.spec.ts`。
- 功能：鼠标在净值／收益曲线上移动时，十字线定位真实观测点，旁侧半透明详情显示日度日期、净值与币种、区间 TWR（或原始累计 MWR）、较上一观测的 TWR、净值变动以及历史盈亏缺失状态。靠近右边缘自动向左展示；移开、失焦或 Esc 关闭，方向键仍可逐点查看。
- 数据口径：区间收益率沿用实际累计 TWR 复合计算，说明实际起点和上一观测日期；MWR 不做区间复合。历史接口目前未提供盈亏金额，显示“— 未提供”，不使用当前未实现盈亏填充历史日期，也不把包含资金进出的净值变化当作投资盈亏；没有制造分钟级时间。
- RED：两个新增悬浮断言在实现前因不存在 tooltip 而失败。GREEN：`npx playwright test --config playwright.ibkr.config.ts workbench.spec.ts --grep 'overview presents|overview never'` 2/2，覆盖入金样本净值变化 +255,000.00 与 TWR +2.04% 分离、无收益来源时不生成收益率、键盘关闭／选择和右侧边界。随后 `--grep 'full HD overview|layout|overview'` 12/12；`npx tsc -b --pretty false`、`git diff --check` 通过。此次未重跑生产构建及既有失败研究任务用例。
- 本机只读视觉检查：1920×1080 真实页面显示悬浮框，页面仍为 1920×1080，无布局挤占。截图 `tmp/workbench-qa/nav-hover-live.png` 已检查，仅保存在本机忽略目录。未修改账户／交易权限，未提交推送。

### 2026-09-07 独立每日账户简报 — 软件 VERIFIED；真实生成 BLOCKED（模型 HTTP 401）

- 需求：总览右栏展示简短账户分析，每个美股交易日收盘后 30 分钟生成。复用现有后台调度、已开启的 daily 偏好和当前 DeepSeek 模型账户分享授权，不新增 Codex 任务，不改交易权限。
- 文件：`server/ibkrBrief.ts`（交易日历、脱敏事实、提示词、数字校验）、`server/ibkrWorkbench.ts`（单次生成、预算与去重、归档、状态、POST brief）、`src/lib/ibkr/workbenchTypes.ts`、`OverviewPanels.tsx/.css`、`AccountWorkbench.tsx`。`server/ibkrAi.ts` 和 `scripts/ibkr-ai-analysis.py` 修复子进程失败时吞掉安全错误码的问题；只公开白名单错误码，不输出原始服务响应或密钥。
- 设计与提示词：`docs/plans/2026-09-07-account-daily-brief-design.md`、`docs/prompts/ibkr-daily-account-brief.md`；运行说明已同步 `docs/runbooks/ibkr-account-workbench.md`。提示词要求约 200～350 字，回答账户现状、主要风险、下一交易日关注事项，缺数据说明。金额和比例使用事实编号，由服务器替换；无搜索和逐仓长报告调用，不推测当日盈亏或新闻归因。
- 调度：NYSE 官方 2026～2028 日历、纽约时区、提前收盘；普通日收盘后 30 分钟，休市不创建新交易日期。重启只补最新一期，先保存尝试与预算再调用，同一期自动尝试一次。失败保留上期内容，HTTP 401／402／403 暂停后续自动调用，配置修复后手动成功生成即可恢复；未知年份暂停。来源：https://www.nyse.com/trade/hours-calendars 。
- RED：新模块首次编译缺失失败；新服务四项测试因 generateBrief 尚不存在失败；浏览器新简报断言在旧占位卡片上失败。GREEN：专属测试 9/9，覆盖时间边界、DST、休市、半日市、2027／2028、未知年份、脱敏／数字引用、并发／去重／归档、权限和预算阻断、撤权与重启、401 暂停与人工恢复。
- 最终验证：`npm run test:ibkr:workbench` 53/53；`npx playwright test --config playwright.ibkr.config.ts workbench.spec.ts --grep 'daily brief|full HD overview|layout|overview'` 13/13；`npx tsc -b --pretty false`、`npx vite build`、`git diff --check` 通过。保留既有大 chunk 提示。工作区其他研究模块与测试的并行现有改动已保留；未删除或弱化其测试。
- 实际接入：当前账户可同步，模型 deepseek / deepseek-v4-pro 已有分享授权，但生成请求被模型端拒绝。首次错误被旧桥接逻辑统一化，修复诊断后最终明确 `AI_HTTP_401`。本轮保存的简报尝试三次（一次自动补生成、两次用于诊断修复后的显式验证），均未产出有效内容；没有用示例或手写内容冒充生成结果。已停止重试，并向用户请求在原模型设置核对 API 密钥／服务地址，不要求在聊天中提供密钥。
- 当前本机 GET state 显示简报 blocked、nextRunAt=null，前端显示“模型鉴权或额度不可用，自动简报暂停”；截图 `tmp/workbench-qa/daily-brief-live-auth-blocked.png` 仅本机保存。实际跨交易日自动生成未运行，真实账户简报未生成成功；需修复模型鉴权后完成实测。电脑和 SparkFlow 后台必须运行，静态页面部署不能执行后台任务。未提交推送。

### 2026-09-08 机会与风险／持仓页面去除分析状态与提问入口 — VERIFIED（展示范围）

- 需求：机会与风险、持仓页面不显示“已有分析正在运行”提示或研究任务横幅；移除机会与风险页底部“问问 AI”输入栏。后台分析不因展示调整而取消，仍只在 AI 分析页展示进度与取消入口。
- 文件：`src/components/ibkr/AccountWorkbench.tsx`、`tests/ibkr/workbench.spec.ts`。机会与风险页从研究任务横幅范围中移除，持仓页保持不显示；只抑制这两个页面中的“已有分析正在运行”重复提示，其他错误仍照常显示。删除机会与风险页的 Chat 组件，不修改账户、AI 授权、模型调用、报告或订单逻辑。
- 验证：新增浏览器回归用例，模拟运行中的账户分析后确认机会与风险、持仓页均无 `.awb-research-strip`、无“账户分析问题”输入框及无对应运行提示；`npm run test:ibkr:workbench` 153/153，`npx tsc -b --pretty false` 通过，`npx playwright test --config playwright.ibkr.config.ts workbench.spec.ts --grep "risk and holdings keep active analysis controls|risk evidence opens archived report"` 2/2。`git diff --check` 无空白错误（仅现有 CRLF 提示）。未提交推送。

### 2026-09-08 统一本地 AI 配置到 Vibe-Trading 与 IBKR — VERIFIED（配置链路）

- 根因：设置页写入用户目录 `.SparkFlow/apikey/integration-settings.json`，而 IBKR 研究桥此前只读取 Vibe-Trading 的 `.env`；因此页面已验证的 `deepseek-v4-flash` 未被账户分析采用，实际仍调用旧 `deepseek-v4-pro` 并出现 `AI_HTTP_401`。
- 文件：`server/ibkrAi.ts` 在每次只读账户 AI 子进程启动时读取、校验并短生命周期注入设置页的 provider、model、base URL 与密钥；密钥不写日志、响应、报告、Git 或环境文件。Vibe 的研究会话保存同一份配置时会启用全局模型锁，`settings_routes.py` 持久化该锁，`swarm/worker.py` 在锁定时忽略预设中的单个模型覆写，避免同一轮研究混用 Flash 与 Pro。`vite.config.ts` 同步此锁。
- 验证：真实本机状态接口已返回 `provider=deepseek`、`model=deepseek-v4-flash`、`configured=true`；未发出模型生成请求。新增环境映射单元用例，`npm run test:ibkr:workbench` 154/154、Python `py_compile`、`npx tsc -b --pretty false` 通过，`git diff --check` 无空白错误（仅现有 CRLF 提示）。Vibe 服务当前未运行，下次从 SparkFlow 发起 Vibe 研究时会同步全局模型锁。
- 权限状态：模型指纹从旧 Pro 变为用户当前 Flash，已有账户数据分享授权已按设计失效（`enabled=false`）；必须由用户在 IBKR「设置」页确认“同意发送上述字段并开启 AI”后，才会向新模型发送账户数据。未自动恢复授权、未发送订单、未提交推送。

### 2026-09-08 简洁每日账户简报 — VERIFIED（离线提示词与校验）

- 需求：每日账户简报仅输出组合变化、最多三项机会／风险、待观察条件和来源；移除长篇宏观、估值、事件日历、价格目标、收益预测及交易指令。
- 文件：`server/ibkrBriefPrompt.ts` 将实际运行指令改为简洁日报；`server/ibkrBrief.ts` 版本升级为 `portfolio-daily-brief-v3`，限制最多三条提醒并要求 `calendar=[]`；`docs/prompts/ibkr-daily-account-brief.md` 与运行手册同步；`tests/workbench/brief.test.mjs` 新增／更新约束回归。
- 来源与安全：账户事实仍只能使用服务器占位符，提醒仍必须引用已读取原文的连续摘录和来源编号；提示词默认不写外部数字，减少 `BRIEF_UNSOURCED_NUMBER` 校验失败面。没有充分证据时允许空提醒并报告数据缺口；不下单，不扩大账户数据范围。
- RED：新增测试在旧版提示词仍允许事件日历和五项提醒时失败。GREEN：`npm run test:ibkr:workbench` 154/154，`npx tsc -b --pretty false` 通过，`git diff --check` 无空白错误（仅现有 CRLF 提示）。未触发真实模型调用，因此最新实盘账户简报尚未重新生成；旧简报不会被覆盖。

### 2026-09-08 简洁日报的可发布降级与本地恢复 — VERIFIED（真实本地结果）

- 触发：用户点击生成后，`portfolio-daily-brief-v3` 已返回三条提醒和空日历，但旧严格校验要求每条都有单标的、逐字证据和所有数字完全匹配，导致整份日报未发布。实际失败记录 `b98c446b-cec1-46c5-a26e-07e5893b9d37` 离线诊断显示：一条组合级提醒无证券归属、两条缺少可核验原文摘录。
- 调整：保留 JSON、账户事实、账户隔离和来源完整性要求；允许有来源的组合级提醒 `symbols=[]`。缺少可核验来源或持仓归属的单条提醒从展示中剔除并在数据缺口中说明；无法与来源核对的外部数字替换为“未核验数值”。不再因单条不合格而丢弃整份日报。伪造内容不显示，未关闭账户／来源安全边界。
- 恢复：新增 `POST /api/ibkr-workbench/brief/recover`，只接受当前账户、当前提示词版本、当前模型授权仍匹配的本地尝试；重新校验并发布合格部分，不调用模型、不增加预算。重启本地服务后已恢复上述真实 v3 结果：1 条已核验提醒、0 个日历事件，账户状态 `ready`，AI 当日调用计数仍为 10。

### 2026-09-08 自动持仓风险速览（v4）— VERIFIED（离线）

- 需求：自动读取已同步的 IBKR 持仓快照，将简报改为不超过 200 字的中文账户风险速览；开头列已取得的 TWR／集中度／现金占比，随后列二至三项实际持仓风险和直接相关事件，结尾展示固定免责声明。用户无需粘贴持仓。
- 实现：`server/ibkrBrief.ts` 升级为 `portfolio-daily-brief-v4`，输入自动注入脱敏持仓、权重、未实现盈亏、现金占比和仅限 `IBKR PortfolioAnalyst` 的 TWR；`server/ibkrWorkbench.ts` 传入已缓存的官方表现数据。纯账户风险提醒需引用对应事实占位符；外部事件继续要求逐字原文与来源。`OverviewPanels.tsx` 显示“账户风险速览”和固定免责声明；提示词、运行手册同步。
- 验证：RED：旧 v3 恢复夹具因版本不匹配失败；长度限制使旧冗长三条提醒失败。GREEN：更新为 v4 夹具与 200 字紧凑三提醒后，`npm run test:ibkr:workbench` 157/157、`npx tsc -b --pretty false`、`git diff --check` 通过。未触发真实模型调用、未下单、未更改账户授权；下一次用户手动生成或收盘后自动运行将使用 v4。

### 2026-09-08 简报发布降级（v4）— VERIFIED（真实本地结果）

- 触发：真实 v4 简报模型已返回完整 JSON 和三条风险提醒，但没有写入服务器事实占位符，旧逻辑将整份输出标为 `BRIEF_FACT_REFERENCE_REQUIRED`。
- 调整：事实占位符、200 字目标均由硬失败改为发布后来源提示；没有外部来源的账户风险草稿保留展示。账户隔离、当前模型授权、只读 Gateway、订单禁用、外部事件的原文来源核验和无法解析 JSON 的失败边界保持不变。完成的本地尝试也可通过既有 recover 端点重新发布，不调用模型。
- 验证：`npm run test:ibkr:workbench` 158/158、`npx tsc -b --pretty false`、`git diff --check` 通过。已用 `POST /api/ibkr-workbench/brief/recover` 从本地原始 v4 输出重新发布：状态 `ready`、三条提醒；恢复前后 AI 当日计数为 11，未产生新增调用。未下单、未改账户授权。
- 文件：`server/ibkrBrief.ts`、`server/ibkrWorkbench.ts`、`src/components/ibkr/OverviewPanels.tsx`、`tests/workbench/brief.test.mjs`、`tests/workbench/brief-service.test.mjs`、提示词说明。
- 验证：`npm run test:ibkr:workbench` 156/156；`npx tsc -b --pretty false`、`git diff --check` 通过（仅现有 CRLF 提示）。未发出订单，未新增外部模型调用，未提交推送。
### 2026-09-09 IB Gateway 模拟盘独立入口 — VERIFIED（只读连接范围）

- 需求：在账户设置的官方 MCP 与实盘 Gateway 旁新增“IB Gateway 模拟盘”，并让所选模式真正决定桥接快照来源。
- 实现：`WorkbenchState` 与本地状态新增 `gatewayMode=live|paper`；设置页提供三个并列入口，模拟盘状态、链路标识、侧栏和页脚均明确标注“模拟盘”。后端按所选模式请求 `/snapshot?mode=paper|live`，切换时清除旧账户选择以防实盘／模拟盘快照混用，旧状态文件缺少字段时兼容为实盘。模拟盘不导入实盘 PortfolioAnalyst 历史；空模拟账户跳过无意义的新闻与宏观证据抓取，避免连接等待。
- RED：新增浏览器用例最初因页面不存在“IB Gateway 模拟盘”而失败。GREEN：连接与 Gateway 浏览器回归 9/9（含 1440px／390px）；`npm run test:ibkr:workbench` 157/157；`npx tsc -b --pretty false`、`npx vite build`、`git diff --check` 通过。生产构建仍仅有现存大 chunk 与动态／静态导入提示。
- 本机实联：当前已启动的 Gateway 经桥接 `127.0.0.1:8765` 成功读取 `paper` 模式，状态为 `connected / empty`、0 持仓、`testData=false`、`placeOrders=false`；第二次选择与同步耗时约 59 ms。截图 `tmp/workbench-qa/gateway-paper-option.png` 已目视检查，显示三个入口和“模拟盘 Gateway 已连接”，未纳入 Git。
- 限制：本步骤仅接入模拟盘只读账户快照，不开启下单；当前模拟账户没有持仓。未提交或推送。

### 2026-09-09 Gateway 来源切换与智能重连修复 — VERIFIED（只读连接范围）

- 根因：切到官方 MCP 时，服务把已保存的 Gateway 模式无条件改回 `live`；再次返回 Gateway 的旧式请求因此访问实盘端口。来源选择只执行同步，不会在桥接缺失时启动桥接；“智能连接”也只确认桥接进程存在，没有确认所选实盘／模拟盘已经返回可用快照。前端请求失败后不刷新诊断状态。
- 修复：官方 MCP 切换保留上一次 Gateway 模式；返回 Gateway 时先同步，未连通则自动启动或复用本地桥接并再次同步。智能连接现在只有在所选模式返回 `connected` 且快照为 `ready|empty` 时才成功，否则返回明确诊断并允许重试。操作失败后页面刷新最新连接状态。模拟盘入口及已连接控制台使用琥珀色，实盘已连接继续使用绿色。
- RED／GREEN：新增服务回归覆盖“paper → MCP → 不带模式返回 Gateway”和来源切换自动启动缺失桥接，修复前分别因模式变回 live、桥接未启动而失败；新增浏览器断言要求模拟盘控制台具有独立类别和 `#e2b55e` 色值。修复后 `npm run test:ibkr:workbench` 158/158；本机 Chrome 执行连接浏览器用例 7/7；`npx tsc -b --pretty false`、`npx vite build`、`git diff --check` 通过。构建仅保留既有大 chunk 与动态／静态导入提示。
- 真实本机只读回归：显式选择 paper 后为 `gateway / paper / connected / empty`，桥接端口 8765；切到官方 MCP 后 `gatewayMode` 仍为 paper；随后以不含 `gatewayMode` 的旧请求返回 Gateway，自动恢复 `gateway / paper / connected / empty`；调用智能连接后仍为同一已连接模拟盘快照。四个快照均 `testData=false`，模拟盘持仓 0；未发送订单。
- 视觉证据：`tmp/workbench-qa/gateway-auto-reconnect.png` 已目视核验，页面显示三个来源入口，模拟盘入口与连接面板为琥珀色，实盘入口保持绿色语义；截图仅保存在忽略目录。未提交或推送。

### 2026-09-09 模拟盘人工下单工作台 — 软件 VERIFIED；首笔真实 paper 订单 BLOCKED

- 范围：新增「模拟交易」页，只允许 `IB Gateway / paper`。live 绑定模型强制 `readonly=true`；paper 必须经用户显式点击后才把同一已核对账户切换为 `readonly=false`。传输升级本身不创建订单，策略／AI 不能调用该按钮。
- 文件：`session.py`、`sdk.py`、`readonly.py`、`gateway_runtime.py`、`app.py`、`paper_api.py` 接通受管 paper SDK；`server/ibkrWorkbench.ts` 作为同源代理注入当前账户和固定 `paper/LMT/DAY` 字段，不向浏览器暴露桥接令牌；新增 `PaperTradingWorkspace.tsx` 与样式、类型、测试。`scripts/configure-ibkr-gateway.py` 增加只允许 paper 的 CLI 备用开关，并保留另一账户模式。
- 功能：IBKR 合约查询与最多 20 个白名单；用户填写订单金额、总敞口、单标的权重、日亏损、频率、行情／账户新鲜度、限价偏离和手续费预留；授权最长 8 小时且服务重启失效。只开放美股／ETF、整股、限价 DAY、常规时段、长仓范围。订单必须先预览，30 秒内再次确认；双击由按钮锁与账本幂等共同防重。支持系统订单状态、部分成交／手续费账本、显式撤单、停止新增订单和对账；外部订单只纳入风险，不擅自撤销。超时进入 UNKNOWN 后先对账，禁止盲目重发。
- RED／GREEN：新增 live 可写拒绝、paper 写握手、只读 binding 拒绝策略、显式 transport 路由、保留 live 绑定、服务端 scope 注入、页面只读提示与完整风险表单用例。最终全量验证：`npm run test:ibkr:unit` 为 288/288 Python + 2/2 JS，`npm run test:ibkr:workbench` 为 166/166，`npm run test:ibkr:e2e` 为 73/73；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 均通过。构建仅保留现有大 chunk 与动态／静态导入提示，Python 仅保留现有 Starlette/httpx 弃用警告。此前两项旧文案／中间态断言已按最终产品行为修正并由完整浏览器套件覆盖，没有删除交易安全断言。
- 真实本机连接：重启桥接加载新路由后，用户已在 Gateway 取消“只读 API”；显式 transport 升级返回 `phase=ready / apiPort=4002 / paperOrdersAvailable=true`。随后 session 为 `paperOrdersAvailable=true / paperOrdersEnabled=false / writesEnabled=false`，paper 快照为 `connected / empty`，净值与可用资金已读取；live 绑定仍 `readonly=true`。NVDA 已由 IBKR 解析为 NVIDIA CORP（NASDAQ，conId 4815747）。2026-09-09 再次调用 feed 1（实时）、3（延迟）和 4（延迟冻结）均返回 `price=null / state=stale / asOf=null`，因此没有可用于限价偏离校验的券商报价。
- BLOCKED：首笔真实模拟盘订单未发送。用户已给出当前 paper 账户、NVDA、BUY 100，但尚未指定限价、单笔最大名义金额、账户最大总敞口、单标的最大权重、当日最大亏损、价格偏离上限、手续费预留和授权有效期；同时当前 IBKR 实时与延迟行情均缺失，现有 fail-closed 风控会拒绝预览。需用户明确上述范围，并让 Gateway 返回可用实时 tick 后才能生成预览和进行单独确认。未向券商发送订单，未提交或推送。

### 2026-09-09 用户策略回测操作链 — 软件 VERIFIED；用户策略验收 BLOCKED

- 文件：`services/vibe-trading/agent/src/ibkr_terminal/app.py`、`strategy.py`、`server/ibkrWorkbench.ts`、`src/components/ibkr/BacktestWorkspace.tsx` / `.css`、`workbenchTypes.ts` 及对应 Python、服务层和浏览器测试。
- 行为：策略回测页可保存不可变的用户 SMA 规则版本，上传 JSON/CSV 日线，明确确认拆股和分红完整性后启动后台回测；服务端重新生成信号并写入数据 SHA256、来源 `user.upload`、成本与版本，支持取消、结果查看和完整重放包导出。结构化策略不执行任意代码，回测不会发送订单，也不构成交易授权。
- RED／GREEN：生产策略保存及上传回测路由先因 403 失败，再以最小路由和前端操作链实现。`npm run test:ibkr:unit` = 290 Python + 2 JS passed；`npm run test:ibkr:workbench` = 167/167；`npx playwright test --config playwright.ibkr.config.ts --grep "strategy backtest"` = 1/1；`npx tsc -b --pretty false` 与 `npm run build` passed。构建仅保留既有大 chunk 和动态／静态导入提示，Python 仅有既有 Starlette/httpx 弃用警告。
- BLOCKED：尚未收到用户自己的策略定义和具备使用权的数据，工程 SMA 示例不算用户策略验收。真实 paper 下单仍沿用上一节阻塞条件；本步骤未向券商发送订单。

### 2026-09-10 市价单预览与 Gateway 会话恢复 — 软件 VERIFIED；真实成交 BLOCKED（API 行情权限）

- 根因实测：`paper/status` 显示 enabled=true、0 本系统订单，但策略 scope.sessionRevision=1，当前 Gateway 快照 sessionRevision=3；`paper/reconcile` 返回 `ACCOUNT_PROOF_SCOPE`。旧交易对象仍引用已断开的连接，因此预览报 `RECONCILIATION_REQUIRED`，前端误译为“订单状态尚待券商确认”。
- 修复：Gateway 连接结束时关闭关联交易对象；状态、预览和配置接口拒绝复用旧连接／旧会话。页面在预览前读取最新状态，按用户本次点击和表单范围重新配置，失败后刷新状态并丢弃旧预览。过期或停止的范围可由用户下一次明确操作重新配置；不自动重发订单。SDK 账户快照请求串行排队，避免后台刷新与下单校验重叠导致连接退出。
- 行情时序：新订阅等待首条真实 tick／盈亏事件，最多 3 秒；按请求 ID 捕获券商行情错误，不把其他订阅错误归到当前股票。保留真实交易时间与报价新鲜度校验；10189／10089／354／10197 显示明确原因。
- RED→GREEN：新增旧连接替换、会话变更、断线清理测试初始 4 项失败；并发账户读取初始因 overlapping account reconciliation 失败；市价单首条 tick 延后及 10189 测试初始失败。修复后 `npm run test:ibkr:unit` = 311 Python + 2 JS passed；`npx playwright test --config playwright.ibkr.config.ts --grep 'market ticket|paper ticket previews|paper trading page'` = 5/5；`npx tsc -b --pretty false`、`npm run build` passed。构建保留既有大 chunk 提示，Python 保留既有 Starlette/httpx 弃用警告。
- 本机验证：确认 0 本系统订单后重启桥接加载修复，`paper/status` 返回 available=true、connected、enabled=false、policy=null、orders=[]，等待用户下一次预览明确本次范围。未提交 Git，未调用订单确认／下单／撤单接口。
- 当时预检受阻：AAPL 实时行情请求收到 10189，真实 tick 数为 0。这是行情权限拒绝，不是交易权限拒绝；当时项目自身要求实时 tick，后续已按下述修复允许明确标注的模拟盘参考估值，不再要求用户购买行情订阅。离线市价单报文与页面流程通过，不等于真实成交验收通过。

### 2026-09-10 模拟盘预检资金与参考估值修复 — 账户实联预览通过；网页成交待验收

- 根因：预检把实时逐笔行情权限作为交易前提；强制要求此模拟账户未提供的 SettledCash；重复 accountSummary 回调未按账户／指标／币种合并；异步 owner loop 内调用同步 accountSummary 导致 RuntimeError。另将持仓市值波动错误当成持仓数量变化。
- 修复：人工 paper 订单允许最新完整持仓读取中的 marketPrice 或 IBKR 延迟行情快照用于资金估算；预览明确标注来源及非实时属性，不使用平均成本冒充报价。无 SettledCash 时保留空值并使用美元现金与 AvailableFunds 较低值；不得用此规则放宽自动策略或实盘。仍保留资金、敞口、频率、账户时效、确认及幂等检查。SDK 摘要按键保留最后一次回调并加入美元 ledger／AvailableFunds；确认读取已完成的缓存，不嵌套事件循环。
- 实联：独立只读连接当前 paper Gateway，使用当前用户交易限额，AAPL 10 股 MKT 的本地预览通过；IBKR 估值参考约 319.37 USD，资金预留约 3358.37 USD。另向券商发起 whatIf=true 的同参数测算，返回 PreSubmitted、warningText 为空、commission=1.00003；此为假设订单测算，未发送可成交订单，不能记为成交。
- 验证：320 Python + 2 JS 单元测试、6 项相关浏览器测试、TypeScript、生产构建通过；构建保留原有 chunk／混合导入警告。新增用例覆盖无订阅参考估值、重复摘要回调、异步缓存读取、现金较低值检查、真实持仓数量变化与普通估值变化的区别。
- 待办：自动审批拒绝终止并重启当前桥接进程，未提供进一步原因（blocked by policy）。当前网页服务尚需用户通过启动器重启以加载这些 Python 修改，然后继续核验预览→确认→券商成交回报。已通过异步问题请求用户重启。未提交／推送 Git。

### 2026-09-10 自动更新桥接与模拟盘成交验收 — VERIFIED

- 智能连接对比正在运行的桥接与本地 Python 源码指纹；旧版自动退出并重启，同版健康进程复用。新桥接使用令牌与实例 ID 校验的优雅退出接口，停止接收新写请求并清理连接／运行锁；旧版兼容脚本只结束监听指定端口、启动模块及 runtime 目录均匹配的 Python 进程。并发连接合并，避免启动多个桥接。
- 修复账户误锁：完整读取后可恢复无系统订单的旧 SDK_SESSION_CHANGED。成交回报中带横线的 UTC 日期先明确时区再交给 SDK，避免 Windows 本地时区造成八小时偏移；历史重复成交仅时间表示错误时保留原始证据、审计修正投影，并在成交／手续费／现金／持仓完整核对后恢复。真实数量、价格、账户或其他冲突仍需处理，不隐藏错误。
- 连续下单：美元账户现金按美分核对，保留手续费小数精度，不把不足半美分的正常舍入当成现金差异；后续新快照可在时间更新且现金／数量与核对结果一致时继续使用。无 SettledCash 的人工模拟盘继续使用现金与 AvailableFunds 较低值。预览自动核对上一单，不要求手动清理进程或盲目重复下单。
- 本机真实模拟验收：Chrome 访问实际 5180 页面，AAPL 10 股 MKT 经预览及明确确认后，IBKR 返回订单 20／permId 1411207073、ACKNOWLEDGED／FILLED、成交 10 股、均价 322.80 USD；账户 AAPL 从 10 股变为 20 股。此为真实 IBKR 模拟成交，非工程夹具，未操作实盘。之后只核对与预览，没有新增买单。
- 重连验收：智能连接成功替换运行中的旧版桥接；成交和审计持久化保留，完整核对后 integrity halt 为空、reservedCash=0、reconciliationRequired=false。再次加载新桥接后，真实网页 AAPL 10 股 MKT 预览返回 HTTP 200，订单数量仍为一笔。
- 验证：331 Python + 2 JS 单元测试、186 服务测试、6 项相关浏览器回归与 TypeScript 检查通过。实际预览／成交／恢复证据仅保存在忽略目录 tmp/workbench-qa，不含令牌，不提交 Git。当前更改未提交／推送。

### 2026-09-10 订单与持仓自动同步

- 交易页面改为串行轮询，前台每次请求完成后约 2 秒同步，后台降低频率，回到页面立即恢复；请求序号防止旧响应覆盖新订单。移除订单区“刷新订单”和“停止新增订单”按钮，显示自动同步状态。
- paper/status 在现有模拟交易会话中自动核对待确认／待对账订单，使用路由锁避免与预览、确认并发操作，且按 2 秒间隔限制重复查询。手续费未到或读数暂不一致时保留已有成交并自动重试。返回同一通道的持仓／现金快照供订单页使用，避免父页面缓存导致成交后持仓延后显示。
- 下单后跟踪同一订单，部分成交、全部成交与撤单回报自动更新交易提示区。自动查询不提交订单、不撤单，也不会自动开启新的交易授权。
- 验证：新增费用延迟／轮询节流／成交资金释放后端用例通过；332 Python + 2 JS 单元测试通过。独立浏览器用例验证已报单→部分成交→已成交及持仓更新、撤单中→已撤单、重载页面，交易写请求为 0；类型检查与生产构建通过，保留既有构建大小警告。
