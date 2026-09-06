# IBKR terminal contracts · v1

2026-09-05；主计划 v1.0 的工程契约。当前快照模型、固定样本、基础只读 HTTP 服务已实现，详见进度文件；标注未来的能力不代表已完成。

## 范围与安全
- 首期假设：美股／ETF、整股、long-only、RTH。用户尚未确认策略或真实风险额度。
- 账户查看、手动订单确认、自动策略授权、AI 数据分享是四种独立权限。
- paper/live/backtest 都通过显式账户绑定隔离；端口和 DU/U 前缀只是诊断线索。
- 没有连接配置时保持 unconfigured；不自动探测登录或连接新账户。测试不能发出真实订单。
- 所有默认 Python 测试使用 pytest-socket 禁止网络；浏览器样本必须由测试拦截注入，不能在生产失败时回退。

## 已实现的快照
源：`services/vibe-trading/agent/src/ibkr_terminal/schemas.py`；固定数据：`tests/ibkr/fixtures/snapshots.json`。

关键字段：`schemaVersion:1`、`snapshotId`、`accountKey`、`mode`、`sessionRevision`、`sequence`、`source`、`testData`、`asOf`、`connection`、`state`、`baseCurrency`、`metrics`、`cash`、`positions`、`orders`、`quotes`、`capabilities`、`missing`、`detail`。

- accountKey 是 mode 前缀的 opaque key，不能携带密码；行账户必须与快照一致。
- 金额／数量使用有限十进制字符串；null 表示缺失，禁止 NaN、浮点值、空串转零。
- cash 按币种保留。没有带时间和来源的 FX，不汇总跨币种金额。指标说明计价币种。
- 合约以 conId 标识，symbol 只用于显示。行情独立标明 realtime/delayed/frozen/disconnected/missing。
- connection 表示传输，state 表示内容，二者分离。空账户和连接失败不混同。
- fixture 必须 testData=true。只读快照不能携带写入授权或 AI 分享授权。
- 订单 submission 与 execution 分离；UNKNOWN 保留预占并先对账。该展示契约还不是订单执行器。
- P2.4 兼容新增 executions/provenance；订单显示 orderId/clientId/permId/brokerStatus，缺少原始 orderStatus 时 filled/remaining=null，不从 SDK 默认值补零。所有只读券商订单 managed=false；external 标识仅用于展示，不充当可提交意图。
- executions 保留 execId、合约、币种、方向、数量、价格、券商时间及手续费；同一次查询按 execId 去重，冲突拒绝。未知手续费／无明确时区的时间为 null；查询窗口不足明确记录 missing，不称完整交易历史。
- provenance 的 observedAt 为本地收到来源事件的时间，requestCompletedAt 为只读请求完成时间，brokerAsOf 无来源则 null。快照 asOf 仅代表生成时间，不能更新源事件时间。金额 NaN/Infinity/IBKR UNSET_DOUBLE 一律缺失，真实零值保留。

## P2 端点与事件
本地服务独立启动，loopback 绑定；Host/Origin 白名单、短期会话与写请求令牌；生产不依赖 Vite。

| 路径 | 行为 |
| --- | --- |
| GET /api/ibkr-terminal/session | 已实现：返回绑定状态及明确配置的账户列表，无自动绑定 |
| GET /api/ibkr-terminal/snapshot?mode=…&accountKey=… | 已实现：指定账户只读快照；不匹配绑定拒绝；P2 当前每模式单账户，可省略 accountKey |
| WS /api/ibkr-terminal/events?mode=…&accountKey=… | 已实现：独立认证的账户流，5s heartbeat、snapshot.patch、resync-required；缺序号或断线后先补 HTTP 快照 |

增量 envelope 包含 mode/accountKey/sessionRevision/sequence/kind/payload。账户切换取消旧请求、清空图表/订单/AI 上下文；不接纳旧 revision、错误账户或递减序号。行情以 100–250ms 合并，订单事件不合并。缺序列后暂停增量直到快照恢复。

当前 snapshot.patch 带 previousSequence，payload 仅允许快照内容字段，不能更改账户标识。每订阅队列上限 64，溢出明确要求 resync；每账户最多 8 条流，退出释放。重绑关闭旧账户流。前端连续 15s 无心跳即标记 stale（5s 检查，最迟 20s 触发），最多 5 次有界重连后等待手动刷新。原始令牌只存在本地受保护目录，开发 HTTP/WS 代理校验来源后代为认证。

主动只读对账每 30s 查询新持仓／挂单／指定账户成交，事件刷新不能推迟对账。使用 reqPositionsAsync 的本次返回集合，避免 positions() 缓存残留；所有读取完成才提交快照，失败保留旧数据并 stale，停止连接任务。sdk.py 对固定 ib_async 2.1.0 的原始回报做最小观察包装，避免 Trade 缓存状态滞后和默认成交数量零；没有调用订单绑定或写入。账户摘要使用已有订阅，不声称每 30s 主动重读。

## P3 已实现的离线订单核心与剩余契约
OrderIntent：accountKey、mode、conId、side、quantity、orderType、limitPrice、TIF、clientIntentId、strategyVersion、authorizationId、sessionRevision。合约细节由服务端合约解析器验证；不用 symbol 推断权限。

授权必须绑定账户、模式、策略哈希、品种范围、单笔／总额／日亏损／频次、有效期和授权类型。手动确认记录绑定预览哈希；自动授权单独持久化。风险检查与预占在同一 SQLite 事务中进行；相同意图不同 body 冲突；恢复 UNKNOWN 时禁止重发。撤单只请求，不直接宣称已撤。停止策略不隐含撤单或平仓。

已验证内部核心：独立 orders.db v6（与快照库分开）、不可变授权记录／撤销、mode+accountKey+clientIntentId 唯一键、80 位 Decimal 运算、事务预占和审计哈希链。保留意图和账户上下文，提交时另存当前上下文与唯一 attempt。订单先 PERSISTED，再原子 claim 为 SUBMITTING；相同请求只能 claim 一次。提交前保存 channel/clientId/orderId/orderRef；ACK 只能补匹配的 permId，不能替换预分配身份。超时／异常／恢复中断为 UNKNOWN 并保留预占，阻止新增意图。重复返回已保存状态，不触发重发。错误类型作为 lastError 和审计证据保留。v1/v2/v3/v4/v5→v6 使用增表迁移，v1 直升测试证明 UNKNOWN 与占用保留，无预留身份的旧单不凭空补号。v5 另存无副作用订单预览及其一次性确认状态；v6 增加 sdk_dispatch_permits 与 sdk_dispatch_attempts，不迁入任何默认授权。

BrokerSession 是已确认连接的可信元数据；channelKey 与模式固定，订单序号在 channel+clientId 范围共享，事务取已持久化序号与 broker 下界的最大值。orderRef 为 SF- 加随机标识，不携带账户。随机 ref、预分配身份、唯一 attempt 同时落盘，随后才交给 transport。只读恢复要求订单引用、所有身份和完整意图字段精确匹配，仍须账户对账才能解除冻结。ib_async 返回的本地 PendingSubmit Trade 不是券商 ACK；原生新订单发送适配已在 P3.3a 离线验证，生产接线与撤改发送仍待实现。

P3.2h/i 已增加 `ManagedOrderObserver`，可选传入 `ObservedIB`，接收 SDK 原始 openOrder/orderStatus/execDetails/commissionReport/error。它没有连接/发送/授权/账户证明方法；默认生产启动仍不挂接。回调在 SDK 填默认值、去重或丢弃无 Trade 缓存的事件之前验证并持久化；账户、当前 revision、channel、订单三类 ID 和来源全部隔离。openOrder 只确认完整条款与归属，不能生成缺失的累计数量；待确认改单由只读 `OrderReconciler.confirm_amendment` 核对原身份、新条款及已发送版本后推进，降低风险仍须账户证明，旧条款回声不会确认新版本。execId 数字后缀更正按持久历史建立替代链，原执行不覆盖，缺前序拒绝；重复旧执行不恢复旧数量。手续费必须匹配已存执行；未知 execId 因缺账户身份不擅自绑定。管理订单错误只记 IBKR_错误码并持久 halt，保留最后已确认执行状态与预占，隔离 SDK 从 error() 推断 Cancelled 的行为；活动只读请求的同号错误不能修改订单。错误恢复消息不能自动解除 halt；后续需显式核对恢复流程。真实写入依然关闭。

RiskContext 是未来服务端可信适配的输入，不可从网页接受。其账户时效必须来自必要账户字段的来源时间，不能用快照生成时间刷新；需要 settledCash、totalCash、完整持仓估值、净值、日亏损、报价与合约规则。externalOrders 只列外部订单；openOrdersComplete 默认 false，缺完整性证据时拒绝。外部 CANCEL_PENDING 仍计入现金／敞口／卖出股数预占；无法确定数量、限价保护、币种或合约规则则拒绝。当前 P2 尚未提供完整输入，不能构造真实可交易上下文。首批内核验证仅覆盖 USD 现金、STK、整股、RTH、DAY 限价；MKT／GTC 与其他范围明确拒绝并等待后续实现。

reconcile.py 已验证管理订单回报：必须精确匹配已记录的 orderId/clientId/permId；其他订单不能获得管理权。回报 eventId 与 execId 分层去重，同 ID 冲突冻结账户。显式 replacesExecId 建立无分叉更正链，原记录不覆盖；手续费版本独立保存，返佣保留符号。有预分配身份的 UNKNOWN 可用 ReadOrderEvidence 只读匹配；旧版无身份的 UNKNOWN 保持待处理。

撤单先 CANCEL_QUEUED 或持久化 SUBMITTING，再交给显式 fixture transport；本地发送返回只为 REQUESTED，收到券商 CANCELLED 才 ACKNOWLEDGED，FILLED 抢先则 TOO_LATE。超时／中断是 UNKNOWN，禁止自动重发。当前只有 fake 已验证，真实 transport 和人工入口待接。部分成交、等待撤单及晚到成交均保留风险；只有同账户的不可变 AccountProof 对事件 watermark、来源时间、有效成交／手续费、现金及持仓逐一相符，才原子释放终态占用或降低未成交部分占用。任何新事件恢复保守预占并要求重新对账。随后新意图必须使用最新 AccountProof 对应的 RiskContext，旧余额不能再次花用已释放资金。

当前账户证明使用首笔本系统意图的现金／持仓基线加全部管理成交。存款、分红、外部成交等无法解释的变化拒绝核对，待独立现金流／外部事件适配；不会把差额自动记为收益。AccountProof 和 BrokerEvent 均是内部可信读取层契约，不接受网页自行声明数据一致。

Authorization.source=fixture 必须显式 allow_fixtures，生产账本拒绝工程授权。source=user 只能由服务端在用户逐单确认未过期预览时生成；浏览器不能提交余额、行情、限额或自签授权。生产 app 只开放窄范围的本地预览／确认 POST，确认结果最多为 PERSISTED 本地意图，不能调用 broker.py 或 SDK；LIVE、缺可信风险 source、跨站请求及其他写方法均拒绝。OrderExecutor 仍仅接受 fixture transport，所有 ibkr source 写入拒绝。真实成交映射、复杂终态、撤改发送、外部现金流对账和可写 IBKR 适配须在获授权的 paper 范围内继续验证；不能把本地订单票、编码器或内核测试当券商集成。

P3.3a `NativeDispatcher` 默认关闭且生产启动未实例化。只接受已由同一 OrderLedger 完成 SUBMITTING/预占/身份 claim 的新订单，另需精确 commandHash、绑定哈希、channel/revision、source、原授权哈希与有效期的不可变可撤销 DispatchPermit。内部 record_permit 不是用户同意证明，未来可信本地确认链负责签发；浏览器目前不能创建许可。许可中的 modify/cancel 是扩展用途，当前 dispatch 明确拒绝这些未接通命令。

新订单 SDK attempt 在 wire 前独立落盘 WRITING，最终发送事务与撤权使用同一 SQLite 写锁。固定 ib_async 编码后在 conn.sendMsg 边界再次复核授权、风险、账户及当前 revision；SDK 必须在同 owner loop，且实际 host/port/clientId 与已确认绑定一致、券商返回账户含指定账号。遇到 SDK 延后队列、限流或 DEBUG 原始报文日志开启时拒绝，不留订单在背景队列。SENT 仅为本地 hand-off，不能产生 BrokerAck；默认 10s、上限 60s 的有界本地 timer 等原始 openOrder 回报，超时/关闭/中断保留 UNKNOWN 与资金预占。恢复同步 SDK attempt 与主账本，不重发。默认测试在 conn.sendMsg 截获原生报文字节，pytest-socket 全禁；没有真实账户或订单。

## 历史行情、策略运行与账户情报

- `GET /api/ibkr-terminal/market-data` 只接受当前会话的 mode/accountKey、当前快照中唯一的 conId 以及 1D/5D/1M/6M/1Y。返回严格递增的 UTC K 线、Decimal 字符串、source、asOf、状态、缺失项与内容哈希。缓存过期仍可显示，但必须标记 stale；生产存储拒绝 fixture。首期 SDK 读取限定 USD 股票/ETF、SMART、TRADES、RTH，未调用订单 API；日线日期暂按 UTC 日界记录，真实账户仍需核对交易所时区及复权口径。
- `strategy_runtime.py` 将激活、交易授权、策略版本和账户会话分别绑定；浏览器没有激活或恢复接口。只允许 paper，生产拒绝 fixture，live 运行明确拒绝。相同序号重复输入幂等，内容冲突、缺序列、陈旧行情、授权失效、重启均停止新增风险。信号通过同一 `OrderLedger.reserve` 原子预占，只产生本地 PERSISTED 意图，不调用券商 transport。停止只禁止新信号，不撤单或平仓。
- Decimal 回测结果保存每根 bar 的现金、市值、权益与回撤曲线；同标的持有基准按首根收盘建立无费用的归一化持仓，并显式应用未复权拆股/分红事件。换手口径为实际成交金额/初始资金。`period-return-v1` 只在至少两个区间收益时提供样本波动与风险调整值，否则为 null/“样本不足”；这些是可复现统计，不代表显著性或未来收益。全部内容纳入 runHash 与重放校验。
- 底部新闻复用 `/api/news-feed`，保留来源、原文 HTTP(S) 链接、发布时间、抓取时间和 stale 标记；危险协议不可点击，文本由 React 转义。持仓筛选使用当前账户全部 symbol 作显示关联，不把 symbol 当交易身份。宏观复用 `/api/global-macro-dashboard?region=global&section=macro`，逐项保留 sourceUrl、status、源数据时间及源提供的统计期；源未单列 period 时明确显示“统计期未单列”。界面不声称因果；报告中只有新闻标题/摘要的精确持仓代码文本可关联 conId，宏观统一标 `ACCOUNT_CONTEXT_NOT_CAUSAL`。微观在没有数据源/权限时显示未接入并在报告记缺口。AI 联动开关只选择上下文，仍显示“尚未分享”。
- 风险指标由本地 Decimal 代码计算并逐项携带来源；报告 schema v2 按不可变快照输出 JSON/Markdown/HTML/PDF，明确包含摘要、账户概况、收益归因、风险、外部证据、建议及来源与限制。当前快照缺期初权益、净现金流和分段收益时，收益归因必须写“数据缺失”，不能估算。最多 100 条外部证据必须是 HTTP(S)、同一 fixture/production 来源类别，holding conId 必须存在；URL、抓取时间、关系、缺口和确定性章节文字进入报告哈希，HTML/PDF 提供来源链接。pre-evidence 与 schema v1 报告分别按各自旧哈希公式只读校验。报告任务使用独立 SQLite 和受限线程：创建立即返回，账户/模式/快照固定，可取消；未发布产物只在暂存目录，进程重启把未完成任务标 INTERRUPTED 而不自动重放。AI 分享默认关闭，授权绑定账户、快照字段、provider/model、预算和有效期；当前没有模型调用器、交易工具或浏览器授权创建接口。

## P4–P7 策略与分析契约

`StrategyDefinition` 是带来源标签的不可变结构化契约。首期已验证信号白名单只有基于已闭合 bar `close` 的 `sma_cross`、固定整股且只做多的仓位算法、明确成本假设、最大持仓和版本说明。`signals.py` 是回测 `backtest_signals_from_definition` 与 paper `runtime_signals_from_definition` 共用的纯信号核心；任意代码、未来 DataFrame、乱序观察、跨标的、无效哈希、分数股、做空和未验证多资产均拒绝。浏览器编辑器只生成本地 JSON 草稿，不能保存、授权、激活或提交订单。

P3.2e/f 补充：amend_order 与 new_order 是分离的授权用途。改单只接受绑定订单版本和快照的独立手动确认，记录 candidate/activeIntent，不覆盖原始 intent/bodyHash；同一券商身份修改，不撤重下。新旧风险保留较大值，部分成交只预占新条款剩余量，下降的占用等新条款回报及账户核对后释放。改单计入日／分钟命令计数。预览后有新成交、撤权或过期则不能发送。SENT 不代表券商确认，超时／中断 UNKNOWN；可放弃未发送的预览，不能通过本地状态撤回已发送命令。复杂终态和明确拒绝映射待 SDK 桥补齐。

order_codec.py 只构建 ib_async 对象，无连接／发送。限定已解析 STK/USD 合约与 DAY 限价，数量价格传 Decimal，保留原身份，unsupported 策略拒绝而非改写。测试调用实际 SDK 编码并在 send 处截获，socket 全禁用；本地 PendingSubmit/permId=0 不能生成 BrokerAck。这个结果不是实际券商下单验收。

AI 上下文绑定不可变 snapshotId 和已同意的字段／模型。新闻和报告是数据，无执行权限。评分、归因和敞口由确定性代码计算；缺数据展示不足。报告保存快照哈希、策略版本、来源及限制；不会默认加入全局日报。

## 依赖与可恢复运行
- 已安装验证：Node 24.13.0；Python 3.11；ib_async 2.1.0、FastAPI 0.139.0、Pydantic 2.13.4、Uvicorn 0.51.0。
- 生产依赖继续服从现有 `services/vibe-trading/requirements-lock.txt`，不升级交易 SDK。
- 新增测试依赖：package-lock 锁定 @playwright/test；`requirements-ibkr-test.txt` 锁定 pytest 8.4.2 / pytest-socket 0.7.0。
- 默认浏览器使用机器已有 Chrome；可设置 IBKR_TEST_BROWSER_CHANNEL=msedge。下载 Playwright Chromium 遇到 TLS ECONNRESET，未关闭证书验证；改用本机浏览器通过。
- 入口：npm run test:ibkr:unit、npm run test:ibkr:e2e、npm run test:ibkr:performance。性能脚本使用生产构建、机器已有 Chrome 和明确 fixture，记录 LCP、图表就绪、交互 p95、rAF、CDP heap/DOM/请求与控制台错误；短跑已通过，60 分钟结果另见 `docs/design/ibkr/performance/latest.json`。headless rAF 不等同物理显示器帧率。
- 原 HTML 字节哈希：F80E02E4852D19D366544228D37B7C1878EF1D8974A8B9D21FE4628DB14EE14D。
- 截图：screenshots/reference-1440x1000.png 和 reference-1920x1080.png。固定时钟 2026-09-04T12:00Z、random=0.5、禁用远程字体请求；仅作用于测试页面，不修改归档 HTML。截图含原型虚构数据，不能作账户证据。

## 外部验收待办
用户登录 Gateway/TWS 并提供账户及只读配置；单独指定 paper 测试范围；提供用户策略、交易日观察时段、风险上限；确认行情订阅和 AI 字段／模型／预算。live 写入需另行完整授权。以上均不阻止离线开发。

## 2026-09-06 人工 paper 增量契约

生产路由新增 GET `/paper/status`、`/paper/contract` 与 POST `/paper/configure`、`/paper/preview`、`/paper/confirm`、`/paper/cancel`、`/paper/stop`（前缀 `/api/ibkr-terminal`），只在启动传入 paper_ledger 时安装，代理严格白名单。默认未配置、live 拒绝；用户限定账户、conId、风险额度与有效期后独立启用人工 flow，每个发送仍需精确 bodyHash 与逐笔确认。绑定 readonly:true 是启动/账户读取语义，不授予人工或策略交易；旧 fixture-only executor 保留。

生产风险 source 仅用新鲜指定账户 portfolio、summary、真实 PnL、合约规则与带券商时间戳的逐笔成交报价，不接受延迟或无时间 last 快照。初期只支持 USD 美股/ETF 整股、只做多、DAY LMT/RTH；任何已有挂单、缺少风险数据均拒绝。完整账户证明/余额现金流映射和原生改单仍未完成，终态预占不能无证据释放。

SDK 原生新单/撤单以持久命令与独立许可发送，最后 wire 边界重查授权/风险/身份，重复不重发；本地 SENT/REQUESTED 不能视作券商 ACK。重启单实例锁取得后恢复未决为 UNKNOWN，不恢复风险范围。停止新增不撤单、不平仓；当前重设范围需重启。真实接入已成功读取当前账户，发单/撤单仍未验证，不能把离线测试或本契约作为交易授权。
