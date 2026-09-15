# 账户研究与 AI 助手共用报告

账户页“生成今日分析”和 AI 助手“分析一下我的当前持仓情况”均通过 `/api/ibkr-workbench/analyze` 启动研究。服务端冻结当前账户快照，使用同一个持仓提示词在 Vibe 创建会话，保存 session / attempt 标识并在后台读取结果。助手页面只打开该会话，不再次发送研究消息。

生产环境通过 `vite.config.ts` 注入 `createAssistantResearch`。旧研究代码保留给历史输出的重新校验，以及未注入适配器的兼容测试；生产环境的新分析不再运行旧的独立分析模型。账户模型授权、最新快照检查、任务互斥、账户隔离和取消继续由工作台执行。额度按一次研究任务预留，Vibe 内部可能执行多轮模型与工具调用。

新报告标记 `content.reportFormat = 'markdown'`，原文存入 `rawContent`，阅读、HTML / PDF 导出使用同一份原文。报告在服务端账户目录中保存，不进入公共数据缓存。浏览器关闭不影响已启动任务；服务进程停止则任务按已有中断机制处理，不自动重复发起付费生成。

## 报告内追问

报告下方的提问区与正文等宽。请求只提交 `parentReportId`，后端在当前账户内解析对应报告，不接受客户端指定会话。新报告同时保存 `assistantSessionId`、`assistantAttemptId` 和追问的 `parentReportId`；旧报告可从当前账户中 `reportId` 精确匹配的任务恢复会话关联。

追问复用原 Vibe 会话，在原会话中新建一次 attempt，不新建 session；补充最新账户快照及选中报告的完整原文（标记为资料，不执行其中指令），避免历史消息长度裁剪丢掉原报告。超过合计 64000 字符则拒绝，不截断。回复保存在独立历史记录中，并显示在原报告下方；原报告不覆盖。重试继续保留同一父报告及问题。

原会话缺失、连接失败或忙碌时明确失败，不静默新建会话。不确定的追问 POST 不重试，也不取消尚未确认属于本次请求的任务。`require_idle` 在 Python 创建消息前再次检查运行状态，避免多个入口同时追问。新建分析仍创建独立研究。部署需重启 API 和 Python 研究服务以加载这些变更。

## 风险结论

提示词要求结尾单独输出：

> 今日整体风险关注度：高（风险指数 78/100）——具体风险原因。

以上仅为格式示例。0–32 为低、33–66 为中、67–100 为高；指数是 AI 的关注判断，不是亏损概率或经过统计测量的风险指标。解析器只接受结尾明确给出的有效整数，且等级与分数必须一致。缺失、越界或矛盾时保留全文，仪表显示“评分暂缺”，不估算、不自动追加模型调用。旧报告没有评分时同样不补造数字。

## 失败与取消

- 一次提交仅发送一次 Vibe 消息；不重试结果不确定的 POST。
- 临时读取错误只重试查询。只取本次 attempt 的成功报告，失败回复与旧会话结果不能被误当成本次报告。
- 取消与超时携带本次 attempt 标识向对应 Vibe 会话发送取消请求；如果会话已经进入下一轮，不会误取消后来的任务。
- 多持仓输入允许最多 64000 字符，超过上限明确失败，不静默截断持仓。
- Markdown 使用安全渲染，不执行模型提供的 HTML 或脚本。

## 离线验证

```powershell
node scripts/verify-ibkr-workbench.mjs
services/vibe-trading/.venv/Scripts/python.exe -m pytest tests/workbench/test_assistant_schema.py -q
npx playwright test --config playwright.ibkr.config.ts tests/ibkr/portfolio-assistant.spec.ts
npx tsc -b
npx vite build
```

测试使用合成账户、模型和接口，不连接真实账户、不产生真实订单或付费 AI 报告。部署时需重新启动前端 API 服务和 Vibe Python 服务，以加载新适配器与请求长度校验；旧报告不会自动重跑。
