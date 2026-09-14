// Suggested editorial structure, not a validation schema.
export const ACCOUNT_RESEARCH_INSTRUCTIONS = `
请以全球宏观与多资产组合研究的视角，结合完整账户快照进行一次综合分析。
外部行情与财务资料可能来自多个渠道。quotes中的missing/unsupported仅表示那一个报价通道无数据；请同时检查evidence中的profile.market、fundamentals和valuationSupplement，不能因此断言某标的完全无报价或无基本面。按各来源时间分别引用，不把不同日期、币种或会计口径的数字直接拼接。
开头先用一段“全文总结”概括核心结论。正文依次包含以下内容：

一、账户信息
用一句话给出“今日整体风险关注度：高/中/低”及原因。
分析账户前几大持仓是否存在估值过高风险或价值投资机会，结合估值、盈利质量与证据缺口说明。
用【机会】与【风险】两栏整理判断，每条建议不超过两句话，必要时可以展开，不因句数省略关键信息。

二、持仓解析
集中度与穿透式风险：用已提供数据计算或引用单股集中度、行业集中度，检查流动性、汇率与事件风险。ETF穿透仅在有可靠成分及权重资料时计算；缺失时明确未知，可讨论共同因子但不虚构穿透权重。
用三套公开投资框架分析持仓并给出建议（不是三位投资者本人发言）：
- 巴菲特式价值投资：护城河、现金流、估值与安全边际。
- 彼得·林奇式成长股：公司类型、增长质量、盈利增速与估值匹配。
- 雷·达利欧式宏观对冲：增长、通胀、利率、美元的状态；基于证据判断宏观周期象限，说明对哪些持仓带来机会与风险，不确定时说明条件与分歧。

三、盘前新闻
盘前需关注的重点新闻或事件；过去一周宏观经济数据、政策、地缘风险；行业轮动与AI发展进展。联系具体持仓，注明事件时间、市场/时区与来源，盘中或盘后分析说明下一交易时段关注点。旧资料作为背景，不冒充本周新闻。

四、总结
整理“今天最需要关注的3件事”（建议约3项，实际数量随内容调整）。
按时间先后列出未来7–14天关注日历，包括重要新闻、事项和金融风险；未定日期单列，不编造事件时间。
指出账户与持仓最需要关注及解决的问题、优先次序和可行应对。

展示偏好：全文总结和风险一句话会单独用于账户总览，因此fullSummary应是独立连贯的总结，riskSummary应包含风险关注度及原因，不要把所有重点事项塞进标题。可用Markdown **重点词**、标的和关键数据帮助阅读，无需输出HTML或颜色代码。
上述是写作提纲，不是硬性格式约束；不限制篇幅、字段数量或条目数量，可增补章节。先充分利用已提供的行情、财务指标、宏观序列和账户计算，给出可执行的判断；不要用缺口清单代替分析。仅在缺失会影响结论时简要说明，并给出可验证的观察条件，技术性失败合并到gaps，不逐仓机械重复。ETF不是经营性公司，不把无公司财报当作异常。不要输出只有symbol/weight/type的空持仓章节；持仓文字可以用background或note表达，重点数据写入相关段落即可。优先返回JSON方便分区，也接受Markdown或自然段。
推荐字段（均可按内容选用）：fullSummary（开头全文总结）、riskSummary（风险一句话）、headline（简短标题）、accountSummary、valuationReview（symbol/verdict/rationale/evidenceIds）、opportunities、risks、portfolioRisk（集中度与穿透式风险）、frameworks（buffett/peterLynch/rayDalio，每项analysis/commentary/evidenceIds）、holdings、preMarketNews、marketContext（过去一周宏观政策地缘）、industryRotation、aiDevelopments、briefPoints（今天重点事项）、calendar（date/event/impact/symbols/evidenceIds）、keyIssues（最需要解决的问题）、reviewedSymbols、gaps。自由章节也会保留。
reviewedSymbols只列实际分析的持仓。引用可摘要或改写，但不冒充原文引语；来源ID使用提供的evidenceIds，无法核查时说明。额外行动建议actions可使用symbol/action（hold/watch/increase/reduce）/horizon/rationale/trigger/invalidation/targetWeight，目标权重未知填null，仅供用户制定计划，不自动下单。
`;
