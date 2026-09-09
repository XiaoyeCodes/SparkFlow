# IBKR terminal 开发运行与当前限制

> 历史文档：原交易终端页面及其前端功能已移除。本文中的终端界面、网页订单／策略流程和旧前端测试命令不再适用；当前使用方式见 [账户分析工作台](ibkr-account-workbench.md)。本地账户服务仍供工作台的 TWS/Gateway 来源使用。

检查点：2026-09-05。目标未完成；离线页面、只读适配、订单核心、回测、paper 策略运行骨架、账户风险/报告与性能工具均已推进，真实账户、用户策略及交易授权仍待用户检查点。以 `docs/plans/ibkr-terminal-progress.md` 作为恢复入口。

## 本地启动

在项目根目录 PowerShell 运行：

```powershell
& ./scripts/start-ibkr-terminal.ps1
```

默认不读取连接配置、不连接券商。服务默认绑定 `127.0.0.1:8765`，也可用 `-Port 18765` 或环境变量 `SPARKFLOW_IBKR_BRIDGE_PORT` 指定其他本机端口。脚本会把最终端口写入 `.sparkflow/ibkr-terminal/bridge.port`，账户工作台读取同一文件，因此不需要把端口写死在网页配置中。无账户时返回 unconfigured。脚本为 `.sparkflow/ibkr-terminal` 设置当前 Windows 用户 ACL；SQLite、令牌、端口文件均位于该目录，不提交 Git。结束该前台进程使用 Ctrl+C。

另开终端启动已安装依赖的开发网页：

```powershell
npx vite --host 127.0.0.1 --port 5180
```

访问 `/ibkr`。Vite 仅代理已保护的只读接口，令牌不进入浏览器，不允许下载 `.sparkflow`。必须使用 127.0.0.1，而不是别名域名。`npm run dev` 仍保留项目原有 predev 准备流程。

真实只读绑定尚待用户在官方客户端登录并启用 API Socket；届时可显式传入 `-BindingFile`。文件为数组，每个模式首期只绑定一个账户，字段为 mode、accountKey、brokerAccount、confirmed:true、host:127.0.0.1、port、clientId（必须 >0）、readonly:true、baseCurrency。不放密码或 MFA。可在 Gateway 登录完成且 Socket 已监听后运行 `services/vibe-trading/.venv/Scripts/python.exe scripts/configure-ibkr-gateway.py --runtime-dir .sparkflow/ibkr-terminal --gateway-port 4003 --mode live`，由只读 SDK 发现唯一受管账户并写入本机绑定；脚本不会打印账户号。不要以端口或账户前缀推断授权。

live 写入没有可启用的开关。paper 另有受限人工路径：用户先确认当前 paper 账户的风险范围，再对每笔精确订单预览和确认；服务端才会创建原生 SDK dispatcher，并把回报交给受管订单账本。未完成用户确认、账户核对、实时成交报价、当日 PnL 或 Gateway API 写权限时，服务端拒绝发送。切换 LIVE 仍只是查看模式。SDK 的 clientId=0 会自动绑定外部订单，因此服务端禁止。

## 已运行的验证

```powershell
npm run test:ibkr:unit
npm run test:ibkr:e2e
npm run test:ibkr:stream
npx tsc -b --pretty false
npx vite build
npm run test:macro-release
npm run test:market-cache
npm run test:isolated-market-data
```

最近一次全量单元测试结果见进度文件，覆盖订单库 v1→v6 迁移、原子预占、身份、UNKNOWN、撤改/成交/手续费、历史行情、Decimal 回测、策略 runtime、AI 同意、报告后台任务及备份恢复。浏览器覆盖参考图、五种视口、账户晚到响应、WS 恢复、订单本地确认、10,000 根 K 线、回测/runtime、新闻证据/搜索和报告任务。截图在 `docs/design/ibkr/screenshots/`。Playwright 使用本机 Chrome；可用 `IBKR_TEST_BROWSER_CHANNEL=msedge`。工程数据只由测试注入并显著标识。`test:ibkr:stream` 另起完全未绑定的本地服务和实际代理，验证真实浏览器 WS 握手及 3 次心跳；不构造券商适配器。

本地未绑定服务探针：session 200/accounts=[]；snapshot 200/unconfigured；令牌文件 403；订单 POST 403；恶意 Origin 403。该结果没有访问 IBKR。探针结束后相关端口 8765/5187/5188 已无监听。

## 未完成及限制

- 页面已绘制账户范围历史 K 线并标明来源、时效、哈希、实时/延迟/冻结/断线/缺失状态；真实 IBKR 历史权限、交易所时区与复权口径尚未核对。挂单／成交支持只读展示、来源时间和 25 行分页；全部券商订单默认外部只读。
- P3 内部账本、一次性提交、发送前身份、管理订单事件、账户对账、撤改和本地订单界面已离线验证。受限 paper dispatcher 已接入生产账户服务，但仅由显式 paper 风险范围创建；实时报价、当日 PnL、Gateway 写权限和用户精确测试范围未满足前保持拒绝。所有测试限额、策略和授权都是工程样本。原始 SDK 成交更正/手续费/UNKNOWN/改单回报已有离线验证；撤改原生发送与外部现金流对账仍需真实 paper 验收。live transport 仍无路径。
- P4/P5 支持不可变结构化策略、Decimal 回测/归档/worker，以及绑定账户、授权、版本、序列和快照的 paper runtime。首期白名单仅允许闭合收盘 SMA 交叉、固定整股、只做多；回测和 paper 从同一纯信号核心生成目标，成交仍在下一根 bar。分析页可以生成本地用户策略 JSON 草稿，但不会保存、运行或授权。runtime 只生成本地 PERSISTED 意图；浏览器不能激活策略，停止只禁止新增信号。没有用户策略或两个获授权 paper 时段，因此不构成策略验收。
- 风险分析和四格式本地报告可追溯；schema v2 明确输出摘要、账户概况、收益归因、风险、新闻／宏观／微观证据、建议及来源与限制。缺期初权益、净现金流或分段收益时，收益归因保持“数据缺失”。报告通过持久后台任务生成，可查看/取消，重启不自动重放。新闻保留来源、发布/抓取时间、stale 与安全链接；生成报告时，精确持仓代码提及可关联 conId，宏观只作为 `ACCOUNT_CONTEXT_NOT_CAUSAL` 账户级上下文，微观无权限则记录明确缺口。证据 URL、时间、关系、缺口和章节文字进入报告哈希；pre-evidence 与 schema v1 旧报告仍按各自原始哈希只读校验。AI 分享默认关闭且当前没有模型调用器。
- 已有 WebSocket 增量／5s 心跳、SDK 5s 健康检查及断线事件通知、订阅清理、缺序号补快照。每 30s 主动查询持仓、可见挂单和指定账户成交，失败保留旧快照并 stale，停止连接任务，不自动重试登录。摘要沿用 SDK 订阅更新；回调 observedAt 与本地 requestCompletedAt 分别展示，不伪造券商原始时间。
- 只读成交是券商本次返回的可查询时段，不是完整历史账本；迟到手续费下次对账可补齐。没有原始 orderStatus 回报时 filled/remaining 为 null，SDK 默认零值不冒充事实。成交更正和跨会话历史归并留待 P3 审计账本。
- HTTP service 本身不依赖 Vite；当前网页连接和窄代理已在开发/测试主机验证。独立打包安装仍待最终交付核对。
- 快照隔离 mode/accountKey/revision/sequence，恢复仅显示 stale/reconciling。数据库 v2 固定 accountKey 与券商账户指纹绑定，拒绝更换账户复用旧缓存；没有绑定来源的 v1 缓存不自动恢复。
- 未做真实账户／paper 订单／用户策略／跨交易日／live 验证，也未获相应交易授权或 AI 分享权限。
- `test:ibkr:performance` 的冻结候选 60 分钟结果已通过并归档为 `docs/design/ibkr/performance/soak-60m-current-build.json`；完整指标、120 个样本及构建清单见同目录。headless rAF 仅用于发现持续主线程停顿，不等同物理显示器帧率。生产构建仍有大包警告。
- Starlette TestClient 留有 httpx 弃用警告；没有隐藏。真实宏观源 `test:macro-cards` 已在本工作区现有 5180 服务上强制刷新六卡并通过，不能替代 IBKR 行情权限验收。

所有通过结果只证明其对应软件测试，不替代主计划第 12 节的最终验收。
