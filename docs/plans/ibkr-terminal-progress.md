# IBKR terminal progress

## 当前阶段与下一步

- 阶段：真实 paper 只读连接已恢复并持续运行；账户、合约查询和历史 K 线已从 IBKR 返回。实时报价收到 `IBKR_10089`（API 市场数据需要额外订阅，延迟数据可用）并保持诚实的缺失/过期状态。真实 paper 写入仍未发起，需用户先确认精确测试范围与风险上限。

- 下一条可执行操作：在用户确认账户、合约、方向、整股数量、限价、风险上限、有效期和是否允许撤单后，于美股常规交易时段执行一笔受限 paper 下单→回报→撤单→对账；若行情权限或当日 PnL 不足，先记录拒绝证据并不发送订单。随后验证成交/撤单后的账户证明与预占释放。

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

| P2.4b 真实账户核对 | BLOCKED | 只读启动与绑定框架已存在 | 未运行 | 需要用户登录、只读连接配置、明确账户绑定及真实 paper 测试范围 | 继续完成其余离线开发 |

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

| P4 策略与回测 | DOING（已测子项保留） | strategy.py、signals.py、backtests.py、workers.py；StrategyWorkspace/BacktestResults/StrategyDraftEditor；P4 tests/API | 全量 14 JS + 186 Python/28 e2e；共享核心定向 27 passed | 不可变版本、SMA 白名单共享信号核心、仅本地结构化草稿、Decimal 金标准、逐 bar 权益/回撤、基准/换手/波动、重放归档、异步取消/限制/恢复 | 软件仍缺生产策略保存/数据导入/任务启动操作链；另需用户策略与数据权限 |

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

- paper 写入授权：未提供；不访问真实写接口。

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
