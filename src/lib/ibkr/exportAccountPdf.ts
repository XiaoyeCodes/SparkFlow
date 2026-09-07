import type { AnalysisReport, PortfolioMetrics, AccountSnapshot } from './workbenchTypes';

const canvasWidth = 1400;
const canvasHeight = 990;

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
const amount = (value: unknown) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const timestamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未同步';

function positionWeight(position: AccountSnapshot['positions'][number], total: number | null, currency: string) {
  const marketValue = Number(position.marketValue);
  return total && total > 0 && position.currency === currency && Number.isFinite(marketValue) ? marketValue / total : null;
}

export async function exportAccountCommandDeckPdf({ snapshot, metrics, report }: { snapshot: AccountSnapshot; metrics?: PortfolioMetrics; report?: AnalysisReport }) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const currency = snapshot.baseCurrency || 'USD';
  const total = Number(snapshot.metrics.netLiquidation);
  const totalValue = Number.isFinite(total) ? total : null;
  const cash = snapshot.cash.find(item => item.currency === currency)?.amount;
  const positions = [...snapshot.positions]
    .sort((left, right) => Math.abs(Number(right.marketValue)) - Math.abs(Number(left.marketValue)))
    .slice(0, 8);
  const headline = report?.content.headline || '账户快照已就绪，等待新的研究信号。';
  const brief = report?.content.briefPoints?.[0] || report?.content.brief || '导出内容仅呈现券商账面快照与已保存分析，所有操作均需再次核对。';
  const generatedAt = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const root = document.createElement('div');
  root.style.cssText = `position:fixed;left:-${canvasWidth + 80}px;top:0;width:${canvasWidth}px;height:${canvasHeight}px;overflow:hidden;z-index:-1;color:#e9fbf6;background:#050b12;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;`;
  const rows = positions.map((position, index) => {
    const weight = positionWeight(position, totalValue, currency);
    const pnl = Number(position.unrealizedPnl);
    const pnlClass = Number.isFinite(pnl) && pnl < 0 ? 'negative' : 'positive';
    return `<tr>
      <td><span class="rank">${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(position.symbol)}</strong><small>${escapeHtml(position.name || position.symbol)}</small></td>
      <td><div class="weight"><i style="width:${Math.min(100, Math.max(0, (weight || 0) * 100))}%"></i></div><span>${percent(weight)}</span></td>
      <td>${amount(position.marketValue)}<small>${escapeHtml(position.currency)}</small></td>
      <td class="${pnlClass}">${amount(position.unrealizedPnl)}<small>${escapeHtml(position.currency)}</small></td>
    </tr>`;
  }).join('');
  root.innerHTML = `
    <style>
      *{box-sizing:border-box}.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(100,240,205,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(100,240,205,.035) 1px,transparent 1px);background-size:42px 42px}.orb{position:absolute;border:1px solid rgba(86,240,203,.19);border-radius:50%;filter:drop-shadow(0 0 20px rgba(75,226,195,.12))}.orb.one{width:630px;height:630px;right:-300px;top:-265px}.orb.two{width:340px;height:340px;right:-118px;top:-118px;border-color:rgba(119,154,255,.21)}.scan{position:absolute;left:0;right:0;top:128px;height:2px;background:linear-gradient(90deg,transparent,#63ecc7,transparent);box-shadow:0 0 18px #48caaa}.content{position:relative;height:100%;padding:48px 58px}.masthead{display:flex;justify-content:space-between;align-items:flex-start}.eyebrow{font:700 13px/1.1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:2.8px;color:#75edd0}.masthead h1{margin:12px 0 0;font-size:40px;line-height:1;font-weight:750;letter-spacing:-1.7px}.masthead h1 em{font-style:normal;color:#75edd0}.metadata{text-align:right;color:#99b6bc;font:600 12px/1.8 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.6px}.metadata b{color:#d8f7ed}.metrics{display:grid;grid-template-columns:2.25fr repeat(3,1fr);gap:14px;margin-top:36px}.metric{min-height:142px;padding:19px 21px;border:1px solid rgba(129,243,211,.18);border-radius:14px;background:linear-gradient(145deg,rgba(20,47,56,.72),rgba(8,18,28,.75));box-shadow:inset 0 1px rgba(255,255,255,.05)}.metric label{display:block;color:#87a9ad;font-size:12px;letter-spacing:1.2px}.metric b{display:block;margin-top:18px;font-size:28px;line-height:1;font-variant-numeric:tabular-nums}.metric.primary{background:linear-gradient(135deg,rgba(12,52,59,.96),rgba(13,28,46,.9));border-color:rgba(112,238,207,.42);position:relative;overflow:hidden}.metric.primary:after{content:'';position:absolute;width:120px;height:120px;right:-48px;bottom:-68px;border:1px solid rgba(104,242,206,.3);border-radius:50%;box-shadow:0 0 32px rgba(94,230,199,.22)}.metric.primary b{font-size:42px;color:#f1fffb}.metric small{display:block;margin-top:11px;color:#7fa0a5;font-size:11px}.positive{color:#77e9cb}.negative{color:#ff9a95}.lower{display:grid;grid-template-columns:1.78fr 1fr;gap:16px;margin-top:17px}.panel{border:1px solid rgba(129,243,211,.16);border-radius:14px;background:rgba(8,19,29,.76);overflow:hidden}.panel-head{display:flex;justify-content:space-between;align-items:center;padding:17px 20px;border-bottom:1px solid rgba(129,243,211,.12)}.panel-head h2{margin:0;font-size:14px;letter-spacing:1.4px}.panel-head span{color:#79d8c3;font:600 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.8px}table{width:100%;border-collapse:collapse}td{padding:11px 18px;border-bottom:1px solid rgba(129,243,211,.08);font-size:14px;font-variant-numeric:tabular-nums}tr:last-child td{border-bottom:0}td:first-child{width:39%}td strong{display:inline-block;margin-left:9px;font-size:14px}td small{display:block;margin-top:3px;color:#78969b;font-size:10px}.rank{color:#58867e;font:600 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace}.weight{display:inline-block;width:92px;height:4px;margin-right:9px;vertical-align:middle;background:#193239}.weight i{display:block;height:100%;background:linear-gradient(90deg,#55e1bf,#74a7ff)}.signal{padding:22px 23px;min-height:266px;position:relative}.signal:before{content:'AI';position:absolute;right:18px;top:7px;font:700 88px/1 Inter,sans-serif;color:rgba(111,237,206,.045)}.signal h3{position:relative;margin:15px 0 14px;font-size:25px;line-height:1.3;letter-spacing:-.7px}.signal p{position:relative;margin:0;color:#b6cdd0;font-size:14px;line-height:1.75}.signal .tag{position:relative;display:inline-block;border:1px solid rgba(117,237,208,.4);border-radius:999px;padding:6px 10px;color:#8cf0d4;font:600 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:1px}.signal .risk{position:relative;margin-top:24px;padding-top:16px;border-top:1px solid rgba(129,243,211,.12);font-size:12px;color:#8eaeb0}.footer{position:absolute;bottom:30px;left:58px;right:58px;display:flex;justify-content:space-between;border-top:1px solid rgba(129,243,211,.18);padding-top:13px;color:#77979b;font:600 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:1.1px}.footer b{color:#86e9d1}
    </style>
    <div class="grid"></div><div class="orb one"></div><div class="orb two"></div><div class="scan"></div>
    <main class="content">
      <header class="masthead"><div><div class="eyebrow">SPARKFLOW // ACCOUNT INTELLIGENCE</div><h1>PORTFOLIO <em>COMMAND DECK</em></h1></div><div class="metadata"><b>READ-ONLY ACCOUNT SNAPSHOT</b><br>${escapeHtml(timestamp(snapshot.asOf))}<br>${escapeHtml(snapshot.accountKey || 'ACCOUNT UNBOUND')}</div></header>
      <section class="metrics"><article class="metric primary"><label>NET LIQUIDATION</label><b>${amount(snapshot.metrics.netLiquidation)} <small>${escapeHtml(currency)}</small></b><small>IBKR 账面资产 · 快照编号 ${escapeHtml(snapshot.snapshotId || '—')}</small></article><article class="metric"><label>UNREALIZED P&L</label><b class="${Number(snapshot.metrics.unrealizedPnl) < 0 ? 'negative' : 'positive'}">${amount(snapshot.metrics.unrealizedPnl)}</b><small>${escapeHtml(currency)} · 券商账面</small></article><article class="metric"><label>AVAILABLE CASH</label><b>${amount(cash)}</b><small>${escapeHtml(currency)} · 可用现金</small></article><article class="metric"><label>RISK SIGNAL</label><b>${escapeHtml(metrics?.riskLevel || '待计算')}</b><small>最大单一仓位 ${percent(metrics?.topWeight)}</small></article></section>
      <section class="lower"><article class="panel"><div class="panel-head"><h2>HOLDINGS / ALLOCATION</h2><span>TOP ${positions.length} / ${snapshot.positions.length}</span></div><table><tbody>${rows || '<tr><td colspan="4">当前没有可导出的持仓数据。</td></tr>'}</tbody></table></article><aside class="panel signal"><span class="tag">AI SIGNAL SYNTHESIS</span><h3>${escapeHtml(headline)}</h3><p>${escapeHtml(brief)}</p><div class="risk">${escapeHtml(metrics?.reasons?.slice(0, 2).join(' · ') || '尚无触发的规则风险提示。')}</div></aside></section>
      <footer class="footer"><span>GENERATED ${escapeHtml(generatedAt)}</span><b>SPARKFLOW INTELLIGENCE SYSTEM</b><span>RESEARCH REFERENCE ONLY</span></footer>
    </main>`;
  document.body.appendChild(root);
  try {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = await html2canvas(root, { scale: 2, backgroundColor: '#050b12', logging: false });
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({ title: 'SparkFlow Portfolio Command Deck', author: 'SparkFlow Intelligence System', subject: 'Account Snapshot' });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210, undefined, 'FAST');
    pdf.save(`SparkFlow-Portfolio-Command-Deck-${new Date().toISOString().slice(0, 10)}.pdf`);
  } finally {
    root.remove();
  }
}
