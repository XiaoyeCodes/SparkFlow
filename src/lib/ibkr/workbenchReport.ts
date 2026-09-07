import type { AnalysisReport } from './workbenchTypes';
export function holdingChanges(previous:AnalysisReport,current:AnalysisReport){const before=new Map(previous.snapshot.positions.map(p=>[p.conId,p]));const after=new Map(current.snapshot.positions.map(p=>[p.conId,p]));return [...new Set([...before.keys(),...after.keys()])].flatMap(id=>{const a=before.get(id),b=after.get(id);return a?.quantity===b?.quantity?[]:[{conId:id,symbol:b?.symbol??a!.symbol,before:a?.quantity??'0',after:b?.quantity??'0'}];});}
export function reportMarkdown(report:AnalysisReport){
 const c=report.content;const refs=(ids?:string[])=>ids?.map(id=>{const e=report.evidence.find(e=>e.id===id);return e?`[${e.title.replace(/[\[\]]/g,'')}](${e.url})`:'';}).filter(Boolean).join(' · ')??'';
 return [
 `# SparkFlow · 投资组合分析报告`,`${report.version===2?'主动研究 V2':'旧版分析（兼容视图）'} · ${report.generatedAt} · ${report.provider} / ${report.model}`,
 `账户快照 ${report.snapshotId} · SHA256 ${report.snapshotHash}`,
 `## ${c.headline??'今日简报'}`,...(c.briefPoints??[c.brief]),refs(c.evidenceIds),
 '## 账户现状诊断',c.accountSummary,'## 组合风险',c.portfolioRisk,
 ...(report.metrics?[`规则等级 ${report.metrics.riskLevel}`, ...report.metrics.reasons, ...report.metrics.sectors.map(s=>`${s.name} ${(s.weight*100).toFixed(1)}%`)]:[]),
 ...(c.benchmarkComparison?['## 基准比较',c.benchmarkComparison]:[]),
 '## 宏观与周期定位',c.marketContext,
 '## 重点持仓与组合传导',...c.holdings.flatMap(h=>[`### ${h.symbol}`,h.background,h.fact?`**事实** ${h.fact}`:'',h.impact?`**影响机制** ${h.impact}`:'',`**短期** ${h.shortTerm}`,`**长期** ${h.longTerm}`,h.counterEvidence?`**反对证据** ${h.counterEvidence}`:'',h.invalidation?`**失效条件** ${h.invalidation}`:'',...(h.support??[]).map(s=>`> ${s.quote}\n\n${refs([s.evidenceId])}`),refs(h.evidenceIds)]),
 '## 机会与风险',...c.opportunities.map(o=>`- 机会 · ${o}`),...c.risks.map(r=>`- 风险 · ${r}`),
 ...(c.scenarios?.length?['## 情景分析',...c.scenarios.flatMap(s=>[`### ${{base:'基准情景',upside:'乐观情景',downside:'悲观情景'}[s.name]}`,`条件：${s.assumptions}`,`账户影响：${s.accountImpact}`,`应对：${s.response}`])]:[]),
 '## 行动清单',...c.actions.flatMap(a=>[`### ${a.symbol} · ${a.priority?`${{high:'高',medium:'中',low:'低'}[a.priority]}优先级 · `:''}${a.horizon==='short'?'短期':'长期'} · ${{hold:'维持',watch:'观察',increase:'增持',reduce:'减持'}[a.action]}`,a.rationale,a.executionWindow?`执行窗口：${a.executionWindow}`:'',`触发条件：${a.trigger}`,a.riskControl?`风险控制：${a.riskControl}`:'',a.expectedImpact?`预期组合影响：${a.expectedImpact}`:'',`反对证据：${a.counterEvidence}`,`失效条件：${a.invalidation}`,`建议目标权重：${a.targetWeight===null?'待偏好与证据充分后确定':(a.targetWeight*100).toFixed(1)+'%'}`,refs(a.evidenceIds)]),
 ...(c.targetAllocation?['## 目标配置框架',c.targetAllocation]:[]),
 ...(c.monitoring?.length?['## 监控与预警',...c.monitoring.map(m=>`- **${m.indicator}** · 预警线：${m.warningLine} · 应对：${m.action}`)]:[]),
 '## 证据、数据缺口与局限',...c.gaps.map(g=>`- 数据缺口 · ${g}`),...(c.limitations??[]).map(g=>`- 局限 · ${g}`),
 ...(c.disclaimer?['## 免责声明',c.disclaimer]:[]),
 '## 来源记录',...report.evidence.map(e=>`- [${e.title.replace(/[\[\]]/g,'')}](${e.url}) · ${e.source} · 发布 ${e.publishedAt??'未核实'} · 获取 ${e.fetchedAt} · ${e.read?'已阅读原文／原始数据':'摘要线索'} · 相关持仓 ${e.symbols.join('、')||'宏观背景'}`),
 ...(report.research?['## 研究过程',`覆盖 ${report.research.covered.length}/${report.research.total} · 来源 ${report.research.sources} · 搜索 ${report.research.searches} · 阅读 ${report.research.reads} · 模型调用 ${report.research.modelCalls}`, ...report.research.trace.map(t=>`- ${t.at} · ${t.tool} · ${t.ok?'成功':'未取得'} · ${t.target}`)]:[]),
 '本报告为只读研究，所有调整需结合最新账户与行情核对。组合计划统一校验现金，不计手续费、税费与滑点。'
 ].filter(Boolean).join('\n\n');
}
