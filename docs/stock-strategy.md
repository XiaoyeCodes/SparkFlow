# 策略研究

股票市场包含两个子页面：

- `/market`：市场情报，原有指数、资金、热力图、新闻与研报。
- `/market/research`：策略研究，个股报告、15 种策略选择、策略问答、历史记录、Markdown 导出。

## 研究引擎与界面

引擎为 [ZhuLinsen/daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis)，
固定版本 `7a21cd76952c7fe44a7fc5a6113a5b2b8a16bb32`。
`services/daily-stock-analysis` 保存原版 Python 业务模块、行情适配器、策略、报告模板和许可证。
SparkFlow 调用 `AnalysisService.analyze_stock` 和 `build_agent_executor(...).chat`，
用自己的 React 页面展示结果，不依赖外部网页或 iframe。

整合范围是股票研究工作流。上游的独立桌面端、通知渠道、定时调度、网页配置页和 GitHub Actions 不运行；
SparkFlow 现有持仓、回测、AI 助手功能保持原有入口。

## 启动与模型配置

首次运行 `npm run strategy:setup` 创建独立 Python 3.11 环境并安装依赖。
Windows 使用 `requirements-windows-lock.txt`；其他系统使用上游带平台约束的 `requirements.txt`。
setup 预先缓存分词资源并检查真实分析流水线的导入。以后依赖和桥接脚本未变化时立即跳过。
`npm run dev` 的启动检查会自动执行该步骤；打包后使用 `npm run preview` 前也需要准备 Python 环境。

模型、Base URL、API Key、是否使用代理，均读取现有设置
`UserData/settings/integration-settings.json`。页面右上角可打开同一设置面板。
排队任务开始时重新读取配置，保存设置后新任务立即使用最新模型。
支持现有 OpenAI 兼容服务商，包括 DeepSeek、智谱、通义、自定义网关。
密钥仅通过 stdin 传入 Python，不在命令行、历史任务 JSON 或状态 API 中返回。

可选环境变量：

- `SPARKFLOW_STRATEGY_PYTHON`：指定 Python 解释器，默认使用项目内独立虚拟环境。
- `SPARKFLOW_STRATEGY_PROXY`：公共新闻检索代理地址，默认 `http://127.0.0.1:7890`；模型仅在设置开启代理时使用它。
- `SPARKFLOW_USER_DATA_DIR`：已有的用户数据根目录设置，策略研究也遵循此设置。

## 使用

输入 `600519`、`HK00700`、`AAPL` 等股票代码。日、韩、台股使用 `7203.T`、`005930.KS`、`2330.TW`。
不选择策略时走综合分析；可选最多三项策略，选择后使用上游 Agent 策略分析。
研究在后台执行，离开页面、刷新页面不会重复触发模型。
报告完成后可继续追问；追问携带原报告摘要和参考策略，同一会话上下文保存在 SQLite 中。

结果来自实际采集和模型返回。SparkFlow 为美股补充腾讯行情、腾讯前复权日线与新浪日线备用源，
并接入东方财富美股财报。腾讯历史请求使用报价返回的证券全称代码，校验标的和日期，避免取到同名退市证券。
行情保留报价时间；周末返回上次收盘数据，不能当作当前盘中成交。缺失的估值、机构持仓等字段不会补造。

新闻默认检索最近 7 天的 Google News RSS，Bing News RSS 备用，不需要另配搜索 API Key。
公共数据请求与模型代理设置分离：国内行情直连，Google 新闻走上述代理，Bing 先直连再尝试代理。
日期和标的关联度仍由研究引擎过滤；无合格结果时如实显示资料不足。RSS 摘要不等于阅读全文。
免费源可能受限流或网络影响；失败会展示错误，可手动重试，不生成替代演示结果。

报告页兼容原版平铺字段与 Agent 的 dashboard 结构。历史记录中的技术依据、财报观察、新闻和风险提示
会在读取时映射到对应板块，Markdown 导出使用同一映射，不改写历史原文件。

## 本地保存与恢复

`UserData/strategy-research/jobs/`：每个任务独立 JSON，包含请求、进度、结果。
`UserData/strategy-research/stock-analysis.db`：上游行情缓存、分析历史、Agent 会话与诊断记录。
其他上游产生的相对路径文件也限制在此工作目录。整个 UserData 不提交 Git，应随个人数据备份。

任务串行执行，同一运行中请求去重。支持停止、12 分钟总超时，Windows 停止时终止对应 Python 进程树。
服务重启后中断任务不会自动再次消耗模型额度。完成状态等待结果落盘后才对外显示。

## 验证

```sh
npm run strategy:setup
npm run test:stock-strategy
npm run test:stock-strategy:engine
services/daily-stock-analysis/.venv/Scripts/python.exe -X utf8 scripts/verify-stock-strategy-data.py
services/daily-stock-analysis/.venv/Scripts/python.exe -X utf8 scripts/verify-stock-strategy-data.py --live
npx playwright test --config playwright.ibkr.config.ts stock-strategy.spec.ts
npm run build
```

引擎测试使用真实 Python Agent、报告分析器、真实 LiteLLM SDK 和本地模拟 OpenAI 兼容接口，验证自定义模型名、
密钥路由、流式报告解析、工具声明、原报告上下文、跨进程多轮问答和进程树停止。不会调用用户付费模型。
浏览器覆盖 1440 / 820 / 390 像素布局、子页面导航、进度、历史恢复、追问、下载和错误反馈。
数据适配器测试覆盖证券身份、历史日期、财报周期、缺失/零值与新闻过滤；`--live` 只请求公开数据，不调用模型。
