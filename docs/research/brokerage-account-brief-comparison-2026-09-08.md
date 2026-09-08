# 账户简报与大型券商公开能力对照

核验日期为 2026 年 9 月 8 日。本次只读取官方公开资料，未登录券商账户。以下功能比较来自产品说明和公告，不能据此证明某位客户当前已获得相同入口，也不能把公开功能表当成实际简报质量测评。

## 已核实的能力

| 券商与工具 | 官方资料确认的能力 | 对 SparkFlow 的启发 | 适用边界 |
| --- | --- | --- | --- |
| IBKR PortfolioAnalyst 与 AI Commentary Generator | PortfolioAnalyst 提供组合表现、风险、集中度、配置目标与自定义基准。2024 年的 AI 工具公告确认组合摘要、持仓新闻、Fed Beige Book 与 FOMC 宏观摘要、市场展望四部分，并提供研究引用 | 把程序计算的账户事实与外部研究分开，再围绕影响账户较大的持仓组织解释；账户表现和宏观段落之间仍需补足具体传导机制 | 公告里的 AI 工具当时明确面向美国财务顾问，不能据此说普通零售账户均可使用；本次没有核实后续地区扩展。该公告也不证明逐只证券都有完整估值研究 |
| Fidelity Portfolio Analysis 与 Alerts | 公开说明包括资产配置、境内外股票暴露、行业权重及基准比较、股票风格。提醒可跟踪特定证券价格、相对前收盘的变动、均线与区间高低点；官方文章也说明提醒用于经济公告及新闻 | 把长期配置检查与有明确触发条件的事件提醒结合。输出应写出关注的指标或价格条件，提醒必须有触发依据 | 未在本次官方资料中核实与 Schwab 相同的持仓 AI 简报。分析页的部分历史表现是当前资产类别组合的历史信息，不能当成客户实际持仓收益；公开说明不能保证当前界面的菜单位置 |
| Schwab Portfolio Check-up、Securities Alerts 与 Portfolio Insights | 常规工具可比较当前配置、目标配置与基准；证券提醒包括价格、成交量、财报、分红、新闻和研报。2026 年 5 月 5 日公告的 AI Insights 将组合日变动、至多五只对账户影响较大的 S&P 500 股票相关新闻和 Schwab 专家评论结合，可在日内刷新 | 主卡优先解释最重要的持仓变化，把新闻与研究联系起来；明确每个功能的证券覆盖和资料范围 | AI 公告将集中度、配置和技术指标列为未来可能扩展，不可视为已经包含。Insight 涉及的证券不代表整个组合，部分资产被排除。公告将其定义为信息服务，没有承诺个性化买卖建议 |

IBKR 的基础风险和配置能力见 [PortfolioAnalyst Overview](https://www.interactivebrokers.com/campus/trading-lessons/portfolioanalyst-overview/)，AI 四部分及美国顾问限制见 [AI Commentary Generator 官方公告](https://www.interactivebrokers.com/en/general/about/mediaRelations/12-23-24.php)。其零售端另有按实际持仓筛选新闻的 [Portfolio News](https://www.ibkrguides.com/ibkrdesktop/portfolio-news.htm)，这项新闻筛选能力与顾问 AI 工具应分别描述。

Fidelity 的配置、地区、行业和风格能力见 [Portfolio Analyzer](https://www.fidelity.com/planning/investment/content/portanalyze.shtml)，提醒类型见 [How alerts can help you trade and invest](https://www.fidelity.com/viewpoints/active-investor/4-ways-to-use-alerts)。后一篇页面标注 2026 年 7 月 27 日。

Schwab 的常规配置检查和证券提醒见 [Schwab.com 功能说明](https://www.schwab.com/digital-platform/web)，AI 的正式能力与边界见 [Portfolio Insights 发布公告](https://pressroom.aboutschwab.com/press-releases/press-release/2026/Charles-Schwab-Launches-AI-Powered-Capability-That-Helps-Investors-Understand-Portfolio-Performance-and-Market-Activity/default.aspx)。

## 对本项目的判断

以上资料支持把持仓、相关新闻和研究解释结合的产品方向。SparkFlow 值得补足的是同一事件如何传导至多项真实持仓、估值所隐含的经营要求、未来验证条件以及相较上期的变化。这是根据已核实功能提出的设计建议，不能写成已证明优于这些券商。

完整持仓检查与重点提醒展示应分开。只展示三至五条不等于只研究三至五只证券。公司重大事件、估值数据、宏观背景和未来日历是否查到，都应在覆盖记录中留下结果。前台只突出足以影响判断的事项，不能用同一组现金与集中度数字填满每日简报。

## 今日简报评分标准

这是本项目自定的内容验收标准，满分 100，不是券商官方评级，也不代表未来投资收益。

每个细项按 0、2.5、5 分评定，依次代表缺失或错误、部分完成、完整且可验证。评分必须附实际简报中的证据和主要扣分原因。

| 维度 | 满分 | 每个细项 5 分 |
| --- | --- | --- |
| 持仓相关性 | 20 | 准确关联实际持仓；解释组合共同暴露；按影响和紧迫性排序；考虑已知资金规模及用户约束 |
| 外部研究与增量 | 25 | 宏观资料与持仓相关；估值口径适用且资料有效；财报新闻有实质信息；区分新变化与持续背景；检索覆盖与缺口记录可信 |
| 推理质量 | 20 | 传导机制具体；事实判断情景分明；反证或失效条件合理；账户影响的量化或定性边界正确 |
| 观察与行动 | 15 | 观察指标具体；给出验证条件与适用的研究方向；未来事件日期、时区和确认状态可靠 |
| 证据可信度 | 20 | 引用原文支持结论；日期和数据口径一致；数字来源或计算可核验；缺失和冲突信息能使结论降级 |

已经完成相关研究并证明没有重大新消息时，允许正文很短，不按提醒条数扣分。某个领域缺少数据且如实披露，证据可信度可以得分，但研究完整程度仍应反映缺口。无需为了五类分析全部得分而强行让每类占据正文。

出现伪造来源、虚构持仓或足以改变结论的错误事实时，总分最高 59，必须标为不合格。没有外部研究时，作为持仓机会风险简报总分最高 39；账户摘要写得准确并不能替代研究。只有检索尝试记录而未取得有效材料，不算完成外部研究。

90 分及以上表示研究、解释与验证条件都较完整；75 至 89 分表示具备实际阅读价值但仍有明确缺口；60 至 74 分表示仅能作为初步参考；不足 60 分需要补做研究或修正关键问题。任何分数都只评价本期交付内容。

## 评审记录

2026 年 9 月 8 日最后一次配置模型实跑已产生完整 DeepSeek 文本，研究包包含 22 份证据。该文本因 `BRIEF_UNSOURCED_NUMBER` 未通过发布校验，未发布到账户卡。独立内容评审按上述原量表给出 **47.5 / 100，不合格**。

| 维度 | 本轮得分 |
| --- | --- |
| 持仓相关性 | 10 / 20 |
| 外部研究与增量 | 10 / 25 |
| 推理质量 | 7.5 / 20 |
| 观察与行动 | 10 / 15 |
| 证据可信度 | 10 / 20 |
| 合计 | **47.5 / 100** |

主要扣分有三项。

- 没有历史估值序列却判断 AAPL 高于历史中枢，没有适当同行样本却判断 NVDA 估值偏低。文本同时承认缺少相关资料，结论未随缺口降级。
- AAPL 与 NVDA 的金额换算、同比增长以及 NVDA 本季营收环比，经独立复算基本正确，应区分算术有原数据与引用、输出协议不合格。NVDA 增长放缓则缺少连续同口径增速比较，不能由本季同比与本季环比之间的差异推出。
- 通胀回落未说明口径，现有季调 CPI 水平序列不支持对最近一次变化作这一概括，也没有上年同月值支持同比判断。摘要缺少相应的宏观推理和引文。

本轮 KO 会议的原文日期和时区转换正确，形成了一项有效的近期观察提醒。部分正确内容不足以抵消核心判断缺乏依据的问题，不能通过放松数值或引用标准把该文本改判为合格。

本地实际输出记录为 `C:/Users/happy/Documents/SparkFlow/.sparkflow/ibkr-workbench/2ef5c5bd-c7d6-433f-9413-8510740f5a51.review.md`，详细独立评分为 `C:/Users/happy/Documents/SparkFlow/tmp/workbench-qa/brief-final-score.md`。另有 Codex 根据已读取资料独立整理的对照样例，位于 `C:/Users/happy/Documents/SparkFlow/.sparkflow/ibkr-workbench/codex-reference-2026-09-08.md`。对照样例并非 DeepSeek 实际输出，未发布到账户卡，也未用于给本轮模型文本加分。
