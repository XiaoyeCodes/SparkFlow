# SparkFlow IBKR live 就绪与受控启用

## 当前结论

当前软件保持 **live 只读、所有券商写入关闭**。本页是核对和启用前的操作清单，不构成交易授权。浏览器切换到 LIVE、建立只读连接、生成报告或创建本地订单预览，都不会启用实盘写入。

终端“设置”页同步展示授权矩阵：账户查看、人工订单、自动策略和账户 AI 分享为四个独立状态；未填写指定账户、策略／品种、风险限额和有效期时，对应写入保持未授权。

已离线验证的基线为 Git `e276417b441df1e2fca026bdb0c710ede6e61e18` 上的当前未提交任务改动，Python SDK 为 `ib_async 2.1.0`。正式核对时必须记录实际 TWS/IB Gateway 版本、API 设置、账户和运行构建；版本变化后重新跑回归。

## 1. 官方客户端和账户核对

1. 用户在官方 TWS 或 IB Gateway 自行登录并完成 MFA。SparkFlow 不接收或保存用户名、密码及 MFA。
2. 仅允许 loopback API；记录 paper/live 各自的 host、port 和非零 clientId。clientId 0 被程序拒绝，以免 SDK 自动绑定 TWS 订单。
3. 首次只读核对保持官方客户端的 API 只读设置。绑定文件只写 mode、opaque accountKey、brokerAccount、host、port、clientId、baseCurrency、`confirmed: true`、`readonly: true`，放在受限本地目录，不提交 Git。
4. 核对券商返回账户与配置完全一致；检查净值、逐币种现金、持仓 conId/数量、挂单、成交查询窗口和每项来源时间。任何账户不符、摘要缺失、数据陈旧或对账失败都停止并保持只读。
5. 单独核对行情权限：实时/延迟/冻结、历史 K 线、交易时段和币种。没有订阅时页面必须显示权限缺失，不用 fixture 或缓存冒充实时数据。

只读启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-ibkr-terminal.ps1 -BindingFile C:\受限目录\ibkr-bindings.json
```

## 2. paper 写入前检查点

真实 paper 集成测试仍需用户单独给出：paper 账户、允许的股票/ETF conId 或清单、人工/策略用途、策略不可变版本、单笔和总敞口、日亏损、日订单数、价格偏离、交易时段、授权到期时间，以及允许测试的两个交易时段。paper 成交是模拟结果，不证明真实流动性。

开始前应再次证明：

- 页面会话的 `writesEnabled` 仍为 false，直到专用写适配和用户授权同时满足。
- 订单预览的资产、报价、资金和限额都来自服务端已核对数据，浏览器不能自签。
- intent、预占和发送 attempt 在一个持久事务中；重复请求不重发。
- 超时或断线进入 UNKNOWN，先按 orderRef/orderId/clientId/permId 和完整条款只读对账，禁止盲目重试。
- 撤单只在券商终态及账户证明一致后释放风险；停止策略不会自动平仓。

## 3. live 单独授权表

以下字段缺一不可，且一次授权只适用于给定账户和有效期。人工确认与自动策略分别签发，不相互继承。

| 字段 | 必填内容 |
| --- | --- |
| live 账户 | opaque accountKey 与用户核对的 brokerAccount |
| 交易范围 | conId/品种；首期仅美股/ETF、整股、只做多、RTH |
| 策略 | 人工订单或不可变策略 ID、版本、哈希 |
| 风险 | 单笔、单标的、总敞口、日亏损、日订单数、价格偏离和保证金上限 |
| 有效期 | UTC 开始和到期时间 |
| 确认 | 人工逐单或自动策略授权；二者分开 |
| 应急联系人/动作 | 谁可暂停新增风险；平仓仍需独立决定和授权 |

授权过期、账户改变、策略变更、范围扩大、限额提高、行情过期或风控缺数据都会拒绝新增风险。用户未提供上述授权时，不发送任何 live 订单，包括小额“测试单”。

## 4. 备份、恢复与故障处理

运行目录默认是 `.sparkflow/ibkr-terminal`，启动脚本会把 ACL 限制为当前 Windows 用户。备份不会复制 `session.token`、WAL 或 SHM；SQLite 使用在线 backup API，报告逐文件记录 SHA-256。备份本身含敏感账户状态，仍须保存在用户受限目录。

```powershell
services\vibe-trading\.venv\Scripts\python.exe scripts\maintain-ibkr-runtime.py backup --runtime .sparkflow\ibkr-terminal --output C:\受限备份\ibkr-2026-09-05
services\vibe-trading\.venv\Scripts\python.exe scripts\maintain-ibkr-runtime.py validate --backup C:\受限备份\ibkr-2026-09-05
services\vibe-trading\.venv\Scripts\python.exe scripts\maintain-ibkr-runtime.py restore --backup C:\受限备份\ibkr-2026-09-05 --output C:\受限恢复\ibkr-terminal
```

恢复只写入空目录。恢复后先以只读方式启动并完成账户、持仓、挂单、成交和所有 UNKNOWN 命令对账；不能因数据库可打开就恢复写权限。接口错误和日志使用脱敏错误码，不记录 token、密码或完整券商账号。

## 5. 人工应急

- 暂停策略只禁止新增风险，不擅自撤单或平仓。
- 本地服务无响应时，先在官方客户端查看真实订单；不要重启后重复提交原意图。
- 官方客户端、网络或行情恢复后先完成只读对账，再决定是否恢复策略。
- 发现账户不符、无法解释的现金/持仓变化、订单身份冲突或审计链冲突时保持账户 halt，并保留本地数据库和脱敏日志供核查。
- AI 和报告故障不影响订单状态机；AI 没有直接交易工具，账户分享撤销后停止新的上下文构建。

## 尚未满足的外部验收

- 用户尚未提供官方客户端登录后的 paper/live 账户绑定和真实只读核对窗口。
- 用户尚未授权真实 paper 测试范围，也未提供用户策略与真实风险额度。
- 用户尚未授权任何 live 写入。
- 用户尚未确认历史/实时行情及微观数据权限。
- 用户尚未确认 AI 模型、账户字段范围、预算和有效期。

这些项目未满足前，软件就绪状态不能标记为真实 paper 或 live 验收完成。
