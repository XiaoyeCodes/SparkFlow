import type { AccountSnapshot, MarketQuote, PortfolioMetrics, PortfolioPerformance } from './workbenchTypes';
import type { HoldingsRange } from './holdingsAnalytics';
import { holdingIndustryLabel, instrumentTypeLabel } from './industryLabels';

const canvasWidth = 990;
const canvasHeight = 1400;
const firstPageRows = 12;
const continuationPageRows = 14;

type CompanyIdentity = { name?: string; logo?: string };

async function loadCompanyIdentities(positions: AccountSnapshot['positions']) {
  const identities = new Map<number, CompanyIdentity>();
  const manifest = await fetch('/stock-logos/manifest-us.json', { signal: AbortSignal.timeout(4000) })
    .then(response => response.ok ? response.json() : null).catch(() => null);
  const entries = Array.isArray(manifest?.logos) ? manifest.logos : [];
  await Promise.all(positions.map(async position => {
    const entry = position.currency === 'USD' ? entries.find((item: { code: string }) => item.code === position.symbol) : null;
    const identity: CompanyIdentity = { name: entry?.name };
    if (!identity.name && position.currency === 'USD' && position.symbol === 'QQQ') identity.name = '景顺纳斯达克100 ETF';
    try {
      const query = new URLSearchParams({ symbol: position.symbol, currency: position.currency, assetType: position.assetType ?? '', exchange: position.exchange ?? '' }).toString();
      const endpoint = `/api/ibkr-workbench/logo?${query}`;
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
      const data = response.ok ? await response.json() : null;
      if (typeof data?.src === 'string' && (/^\/stock-logos\/[\w.-]+\.svg$/.test(data.src) || data.src === `${endpoint}&image=1`)) identity.logo = data.src;
    } catch { /* Logo lookup must not prevent PDF export. */ }
    identities.set(position.conId, identity);
  }));
  return identities;
}
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
const amount = (value: unknown) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = (value: unknown) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 8 });
const percent = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const timestamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未同步';

function positionWeight(position: AccountSnapshot['positions'][number], total: number | null, currency: string) {
  if (position.marketValue == null || position.marketValue === '') return null;
  const marketValue = Number(position.marketValue);
  return total && total > 0 && position.currency === currency && Number.isFinite(marketValue) ? marketValue / total : null;
}

export function sortAccountPositionsByWeight(positions: AccountSnapshot['positions'], total: number | null, currency: string) {
  return [...positions].sort((left, right) => {
    const leftWeight = positionWeight(left, total, currency);
    const rightWeight = positionWeight(right, total, currency);
    if (leftWeight === null) return rightWeight === null ? 0 : 1;
    if (rightWeight === null) return -1;
    return rightWeight - leftWeight;
  });
}

export function paginateAccountPositions(positions: AccountSnapshot['positions']) {
  if (!positions.length) return [[]] as AccountSnapshot['positions'][];
  const pages: AccountSnapshot['positions'][] = [positions.slice(0, firstPageRows)];
  for (let offset = firstPageRows; offset < positions.length; offset += continuationPageRows) pages.push(positions.slice(offset, offset + continuationPageRows));
  return pages;
}

function positionRows({ positions, quotes, totalValue, currency, identities }: { positions: AccountSnapshot['positions']; quotes: Map<number, MarketQuote>; totalValue: number | null; currency: string; identities: Map<number, CompanyIdentity> }) {
  return positions.map(position => {
    const weight = positionWeight(position, totalValue, currency);
    const quote = quotes.get(position.conId);
    const pnl = Number(position.unrealizedPnl);
    const pnlClass = !Number.isFinite(pnl) || pnl === 0 ? 'neutral' : pnl < 0 ? 'negative' : 'positive';
    const names = [position.name, quote?.name].filter((value): value is string => Boolean(value && value.trim().toUpperCase() !== position.symbol.trim().toUpperCase()));
    const identity = identities.get(position.conId);
    const companyName = names.find(name => /[\u3400-\u9fff]/.test(name)) || identity?.name || names[0] || '公司名称待同步';
    const instrument = instrumentTypeLabel(position.instrumentType || position.assetType);
    const assetMeta = [instrument, position.exchange, holdingIndustryLabel(position)].filter(Boolean).join(' · ');
    const barWidth = Math.min(100, Math.max(0, Math.abs(weight || 0) * 100));
    return `<div class="holding-row">
      <div class="cell asset"><div class="company-logo"><b>${escapeHtml(position.symbol.slice(0, 2))}</b>${identity?.logo ? `<img src="${escapeHtml(identity.logo)}" alt="" />` : ''}</div><div class="company-text"><strong>${escapeHtml(position.symbol)}</strong><span>${escapeHtml(companyName)}</span><small>${escapeHtml(assetMeta)}</small></div></div>
      <div class="cell numeric"><strong>${quantity(position.quantity)}</strong><span>平均成本 ${amount(position.averageCost)}</span><small>${escapeHtml(position.currency)}</small></div>
      <div class="cell numeric"><strong>${amount(position.marketValue)}</strong><span>账面市值</span><small>${escapeHtml(position.currency)}</small></div>
      <div class="cell numeric"><strong>${percent(weight)}</strong><span>账户占比</span><div class="weight"><i style="width:${barWidth}%"></i></div></div>
      <div class="cell numeric ${pnlClass}"><strong>${amount(position.unrealizedPnl)}</strong><span>未实现盈亏</span><small>${escapeHtml(position.currency)}</small></div>
      <div class="cell numeric quote"><strong>${amount(quote?.price)}</strong><small>${escapeHtml(timestamp(quote?.asOf))}</small></div>
    </div>`;
  }).join('');
}

function pageMarkup({ snapshot, metrics, positions, quotes, pageNumber, pageCount, generatedAt, totalValue, currency, identities }: { snapshot: AccountSnapshot; metrics?: PortfolioMetrics; positions: AccountSnapshot['positions']; quotes: Map<number, MarketQuote>; pageNumber: number; pageCount: number; generatedAt: string; totalValue: number | null; currency: string; identities: Map<number, CompanyIdentity> }) {
  const first = pageNumber === 2;
  const cash = snapshot.cash.find(item => item.currency === currency)?.amount;
  const invested = snapshot.positions.reduce((sum, position) => position.currency === currency && Number.isFinite(Number(position.marketValue)) ? sum + Number(position.marketValue) : sum, 0);
  const rows = positionRows({ positions, quotes, totalValue, currency, identities });
  return `
    <style>
      *{box-sizing:border-box}
      .page{position:relative;width:100%;height:100%;padding:0 40px 46px;color:#172536;background:#fff;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}
      .brand-banner{height:86px;margin:0 -40px;padding:0 40px;display:flex;align-items:center;justify-content:space-between;background:#103858;border-bottom:3px solid #c8a365;color:#fff}
      .brand{font-size:27px;font-weight:700}.brand-caption{text-align:right;font-size:13px;line-height:1.6;color:#fff}.brand-caption small{display:block;font-size:9px;letter-spacing:.15em;color:#c6d8e7}
      .masthead{height:100px;display:flex;justify-content:space-between;align-items:center;gap:24px;border-bottom:3px solid #c8a365}
      h1{margin:0;font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-.7px;color:#103858}.kicker{margin-top:8px;color:#68788a;font-size:9px;letter-spacing:.12em}
      .metadata{display:grid;grid-template-columns:auto auto;column-gap:14px;row-gap:5px;font-size:9px;line-height:1.3}.metadata label{color:#718293}.metadata span{text-align:right;color:#17334c;font-weight:600}
      .summary{height:132px;margin:18px 16px;display:grid;grid-template-columns:1fr 1fr;border:1px solid #d0ddea;background:#e2ecf5}
      .summary-item{display:grid;grid-template-columns:140px 1fr;align-items:center;min-width:0;border-right:1px solid #fff;border-bottom:1px solid #fff;font-size:12px}.summary-item label{padding:0 14px;color:#586c7e}.summary-item strong{height:100%;display:flex;align-items:center;padding:0 16px;border-left:1px solid #fff;font-size:14px;font-weight:600;color:#103858;font-variant-numeric:tabular-nums}.summary-item strong.negative{color:#a14643}
      .section-head{height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;margin-top:18px;background:#103858;border-radius:4px;color:#fff}.section-head h2{margin:0;font-size:13px;font-weight:600;letter-spacing:.04em}.section-head span{color:#dbe5ee;font-size:9px}
      .columns,.holding-row{display:grid;grid-template-columns:2.25fr 1.15fr 1fr .85fr 1fr 1.55fr}.columns{height:34px;align-items:center;border-bottom:1px solid #b8c6d0;background:#edf3f7}.columns div{padding:0 12px;color:#536a7c;font-size:8px;font-weight:700;letter-spacing:.09em;text-align:right}.columns div:first-child{text-align:left}
      .holding-row{height:76px;border-bottom:1px solid #d6e0e7}.holding-row:nth-child(even){background:#f8fafc}.cell{min-width:0;padding:10px 8px;border-right:1px solid #e2e8ed;display:flex;flex-direction:column;justify-content:center;line-height:1}.cell:last-child{border-right:0}.cell strong{display:block;color:#172b3d;font-size:13px;line-height:15px;font-weight:700;font-variant-numeric:tabular-nums}.cell span{display:block;margin-top:7px;color:#53697b;font-size:9px;line-height:11px}.cell small{display:block;margin-top:5px;color:#82909d;font-size:8px;line-height:10px}.asset strong{color:#0b5d96;font-size:14px;letter-spacing:.02em}.asset span{color:#243a4c;font-size:10px;font-weight:600}.numeric{text-align:right;align-items:flex-end}.positive strong{color:#28735a}.negative strong{color:#a14643}.neutral strong{color:#34495a}.weight{width:70px;height:3px;margin-top:7px;background:#dce6ec}.weight i{display:block;height:100%;background:#1593cf}.quote span,.quote small{white-space:normal;line-height:13px}
      .cell.asset{flex-direction:row;align-items:center;justify-content:flex-start;gap:8px}.company-logo{position:relative;flex:none;width:28px;height:28px;background:#e2ecf5;color:#103858;display:flex;align-items:center;justify-content:center;font-size:12px}.company-logo img{position:absolute;inset:0;width:28px;height:28px;object-fit:contain;background:#fff}.company-text{min-width:0}.company-text span{line-height:16px;margin-top:3px}.company-text small{line-height:13px;margin-top:2px}.company-text{overflow-wrap:anywhere}
      .empty{padding:78px 20px;text-align:center;color:#718293;font-size:12px;border-bottom:1px solid #d6e0e7}
      .disclosure{position:absolute;left:40px;right:40px;bottom:17px;display:grid;grid-template-columns:1fr auto 1fr;gap:20px;align-items:center;padding-top:9px;border-top:1px solid #9eb1c0;color:#6d7f8e;font-size:8px;line-height:1.25}.disclosure strong{color:#17334c;font-weight:700;letter-spacing:.06em}.disclosure span:last-child{text-align:right}
    </style>
    <main class="page">
      <header class="brand-banner"><div class="brand">SparkFlow</div><div class="brand-caption">账户投资研究<small>ACCOUNT INTELLIGENCE · IBKR</small></div></header>
      <div class="masthead"><div><h1>${first ? '账户持仓与风险快照' : '完整持仓明细 · 续'}</h1><div class="kicker">PORTFOLIO HOLDINGS &amp; RISK SNAPSHOT</div></div><div class="metadata"><label>账户</label><span>${escapeHtml(snapshot.accountKey || '未绑定')}</span><label>账户快照</label><span>${escapeHtml(timestamp(snapshot.asOf))}</span><label>报告生成</label><span>${escapeHtml(generatedAt)}</span></div></div>
      ${first ? `<section class="summary">
        <div class="summary-item"><label>账户净值</label><strong>${amount(snapshot.metrics.netLiquidation)} ${escapeHtml(currency)}</strong></div><div class="summary-item"><label>持仓市值 · ${escapeHtml(currency)}</label><strong>${amount(invested)} ${escapeHtml(currency)}</strong></div>
        <div class="summary-item"><label>现金余额</label><strong>${amount(cash)} ${escapeHtml(currency)}</strong></div><div class="summary-item"><label>未实现盈亏</label><strong class="${Number(snapshot.metrics.unrealizedPnl) < 0 ? 'negative' : ''}">${amount(snapshot.metrics.unrealizedPnl)} ${escapeHtml(currency)}</strong></div>
        <div class="summary-item"><label>购买力</label><strong>${amount(snapshot.metrics.buyingPower)} ${escapeHtml(currency)}</strong></div><div class="summary-item"><label>维持保证金</label><strong>${amount(snapshot.metrics.maintenanceMargin)} ${escapeHtml(currency)}</strong></div>
        <div class="summary-item"><label>完整持仓</label><strong>${snapshot.positions.length} 项</strong></div><div class="summary-item"><label>规则风险 / 集中度</label><strong>${escapeHtml(metrics?.riskLevel || '待计算')} / ${percent(metrics?.topWeight)}</strong></div>
      </section>` : ''}
      <section class="section-head"><h2>持仓明细</h2><span>按账户占比降序 · 共 ${snapshot.positions.length} 项 · 本页 ${positions.length} 项 · PAGE ${pageNumber} OF ${pageCount}</span></section>
      <div class="columns"><div>资产 / 公司</div><div>数量 / 成本</div><div>账面市值</div><div>账户占比</div><div>未实现盈亏</div><div>参考行情 / 时间</div></div>
      <section class="portfolio-grid">${rows || '<div class="empty">当前没有可导出的持仓数据。</div>'}</section>
      <footer class="disclosure"><span>来源：IBKR 只读账户快照及独立参考行情。行情可能延迟。</span><strong>SPARKFLOW · 仅供研究参考</strong><span>不构成投资建议 · ${pageNumber} / ${pageCount}</span></footer>
    </main>`;
}

export async function exportAccountCommandDeckPdf({ snapshot, metrics, quotes = [], performance, range = 90 }: { snapshot: AccountSnapshot; metrics?: PortfolioMetrics; quotes?: MarketQuote[]; performance?: PortfolioPerformance; range?: HoldingsRange }) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const [{ createRoot }, { flushSync }, { createElement }, { HoldingsAnalytics }, { default: chartStyles }] = await Promise.all([import('react-dom/client'), import('react-dom'), import('react'), import('../../components/ibkr/HoldingsAnalytics'), import('../../components/ibkr/HoldingsAnalytics.css?raw')]);
  const currency = snapshot.baseCurrency || 'USD';
  const total = Number(snapshot.metrics.netLiquidation);
  const totalValue = Number.isFinite(total) ? total : null;
  const generatedAt = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const quoteMap = new Map(quotes.map(quote => [quote.conId, quote]));
  const identities = await loadCompanyIdentities(snapshot.positions);
  const positionPages = paginateAccountPositions(sortAccountPositionsByWeight(snapshot.positions, totalValue, currency));
  const chartContainer = document.createElement('div');
  const chartRoot = createRoot(chartContainer);
  let chartMarkup: string;
  try {
    flushSync(() => chartRoot.render(createElement(HoldingsAnalytics, { snapshot, performance, range, print: true })));
    chartMarkup = chartContainer.innerHTML;
  } finally { chartRoot.unmount(); }
  const overviewMarkup = `<style>${chartStyles}
    .ha-pdf-page{box-sizing:border-box;position:relative;width:100%;height:100%;padding:0 40px 46px;background:#fff;color:#17334c;font-family:Arial,"Microsoft YaHei",sans-serif}
    .ha-pdf-page *{box-sizing:border-box}.ha-pdf-banner{height:86px;margin:0 -40px;padding:0 40px;display:flex;align-items:center;justify-content:space-between;background:#103858;color:white;border-bottom:3px solid #c8a365}.ha-pdf-banner b{font-size:27px}.ha-pdf-banner span{font-size:12px}.ha-pdf-title{padding:30px 0 22px;border-bottom:3px solid #c8a365}.ha-pdf-title h1{font-size:28px;margin:0 0 12px;color:#103858}.ha-pdf-title p{font-size:11px;color:#617789;margin:0;line-height:1.7}.ha-pdf-footer{position:absolute;bottom:24px;left:40px;right:40px;border-top:1px solid #9eb1c0;padding-top:12px;display:flex;justify-content:space-between;font-size:10px;color:#617789}
    </style><main class="ha-pdf-page"><header class="ha-pdf-banner"><b>SparkFlow</b><span>账户投资研究 · IBKR</span></header><div class="ha-pdf-title"><h1>持仓与账户表现</h1><p>账户 ${escapeHtml(snapshot.accountKey || '未绑定')} · 快照 ${escapeHtml(timestamp(snapshot.asOf))}<br/>报告生成 ${escapeHtml(generatedAt)} · 图表沿用页面所选日期范围</p></div>${chartMarkup}<footer class="ha-pdf-footer"><span>IBKR 账面快照 / 收益历史 · 金额单位 ${escapeHtml(currency)}</span><span>SPARKFLOW · ${1} / ${positionPages.length + 1}</span></footer></main>`;
  const markups = [overviewMarkup, ...positionPages.map((positions, index) => pageMarkup({ snapshot, metrics, positions, quotes: quoteMap, pageNumber: index + 2, pageCount: positionPages.length + 1, generatedAt, totalValue, currency, identities }))];
  const pages = markups.map((markup, index) => {
    const root = document.createElement('div');
    root.dataset.accountPdfPage = String(index + 1);
    root.style.cssText = `position:fixed;left:-${canvasWidth + 80}px;top:0;width:${canvasWidth}px;height:${canvasHeight}px;overflow:hidden;z-index:-1;`;
    root.innerHTML = markup;
    document.body.appendChild(root);
    return root;
  });

  try {
    // Raster capture reliably preserves SVG charts when they are standalone image resources.
    for (const page of pages) for (const svg of page.querySelectorAll('svg')) {
      const bounds = svg.getBoundingClientRect();
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', String(bounds.width)); svg.setAttribute('height', String(bounds.height));
      const img = document.createElement('img');
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      img.alt = svg.getAttribute('aria-label') || '账户图表';
      img.className = svg.getAttribute('class') || '';
      img.style.cssText = `width:${bounds.width}px;height:${bounds.height}px;flex-shrink:0;`;
      img.dataset.accountChart = 'true';
      svg.replaceWith(img);
    }
    await Promise.all(pages.flatMap(page => Array.from(page.querySelectorAll('img')).map(async img => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([img.decode(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Logo timeout')), 5000); })]);
      } catch { if (img.dataset.accountChart) throw new Error('账户图表渲染失败，请重试 PDF 导出。'); img.remove(); }
      finally { clearTimeout(timeout); }
    })));
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvases = [];
    for (const page of pages) canvases.push(await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', logging: false }));
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({ title: 'SparkFlow Portfolio Holdings & Risk Snapshot', author: 'SparkFlow Research', subject: 'Complete Account Holdings Statement' });
    canvases.forEach((canvas, index) => {
      if (index > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    });
    pdf.save(`SparkFlow-Portfolio-Statement-${new Date().toISOString().slice(0, 10)}.pdf`);
  } finally {
    pages.forEach(page => page.remove());
  }
}
