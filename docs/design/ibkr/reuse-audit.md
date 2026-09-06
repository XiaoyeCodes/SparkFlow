# Existing module reuse audit

审计日期 2026-09-05，基线 e276417。是源码审计和离线验证，不是券商集成证明。

| 模块 | 判断 | 复用／补齐内容 | 验证与限制 |
| --- | --- | --- | --- |
| trading/connectors/ibkr/local.py | 复用映射，补齐连接生命周期 | account/position/contract 映射可沿用；当前每次 connect/disconnect。新会话严格限定 readonly，不沿用吞掉 qualify 错误或 TypeError 后省略 readonly 的退化路径 | 源码检查；账户前缀启发式不是绑定；真实数据核对未运行 |
| trading/connectors/ibkr/profiles.py / trading/service.py | 保持只读保护 | 现有三个 profile 都只读。place/cancel 在非 broker_sdk 处直接拒绝 | test_safety_baseline.py 三个 profile 均无法到达 SDK；不能声称已有 IBKR 写入 |
| live/mandate/model.py / store.py | 复用不可变授权模型概念，须扩展适配 | 有 account_ref、expiry、instrument、funding 等；存储与 gate 按 broker 组织 | 新终端必须逐笔绑定 accountKey/mode/strategyVersion/sessionRevision；已有 gate 不证明这些要求 |
| live/enforcement.py / sdk_order_gate.py | 复用限制检查思想和适用的纯函数 | 有到期、halt、标的、资金与敞口检查 | 使用 float，读余额后提交，不具备新终端 Decimal + 事务预占 + 并发幂等；IBKR 尚未接入 |
| live/order_guard.py | 不能直接作为新 IBKR 通道 | MCP gate 禁止写重试；读取与写入隔离值得保留 | 以 MCP 工具调用为输入；不能让 AI 直接获得新终端订单权限 |
| live/runtime/scheduler.py / jobstore.py | 可适配调度和持久化 | 无需依赖浏览器，调度与执行分开 | 先做账户隔离和统一订单接入测试；当前未启用新定时任务 |
| live/runtime/reconcile.py | 复用分类与不重试原则 | READ callables、unknown_fill/orphan/mid_order_ambiguous、requires_halt | per-broker JSON 快照不能代替新订单／成交 SQLite 账本及 IBKR permId/execId 对账 |
| live/halt.py / audit.py | 适配停止与审计语义 | halt 不隐含清仓，日志脱敏 | 需扩展账户及授权版本范围，验证脱敏与恢复 |
| tools/backtest_tool.py / agent/backtest/runner.py | 复用引擎入口前先金标准核验 | 实际路径是 agent/backtest/runner.py（不是 src/agent/backtest）。加载器、metrics、run_card 可复用 | runner 仍 import signal_engine.py（虽有 AST 限制），Runner 超时子进程不是安全沙箱；新入口使用白名单结构化配置 |
| agent/backtest/engines/global_equity.py、base.py | P4 适配候选 | 优先 local loader 固定数据，验证 next-bar、费用、分红拆股、缺失与时区后再复用 | P0 未运行回测金标准；不能标成可复现回测已验收 |
| server/cozeReportTasks.ts / dailyBriefService.ts | 复用任务传输模式 | 取消、进度、错误与报告渲染模式 | 新增专用账户上下文与单独分享权限，保持原全局日报不读 IBKR |
| src/routes/IbkrAccount.tsx | P1/P2 替换页面与请求管理 | 当前只有 paper 快照 | connected 使用旧 snapshot OR status，断线可能残留已连接；多账户汇总无严格账户筛选；新状态应拒绝过时响应 |
| vite.config.ts / scripts/ibkr-readonly-snapshot.py | 保留旧桥直到新服务可用 | 现有子进程只读桥 | 不承担可靠交易生命周期；新服务由独立启动脚本管理 |

P0 测试未请求账户信息、未登录券商、未连接任何交易 socket。报告、宏观卡片及既有实时源代码本阶段未改。
