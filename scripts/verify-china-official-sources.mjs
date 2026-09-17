import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { officialPeriod, officialText, parseOfficialLinks, parseOfficialMetricArticle, latestOfficialArticle, fetchOfficialNews, fetchExportMetric, officialLists, createVerifiedMetricMerger, alignChinaUsTenYearSpread } from '../server/chinaOfficialSources.ts';

const article = (text, period = '2026-08') => ({ title: 'fixture', text, period, url: 'https://www.stats.gov.cn/release.html' });
assert.equal(officialPeriod('2026年1—7月份全国房地产市场基本情况'), '2026-07');
assert.equal(officialPeriod('2026年上半年金融统计数据报告'), '2026-06');
assert.equal(officialPeriod('2026年前三季度金融统计数据报告'), '2026-09');
assert.equal(officialPeriod('2026年13月'), '');
assert.equal(officialText('<script>假数据</script><p>同比 1.3%</p>'), '同比1.3%');
const pmi = parseOfficialMetricArticle('pmi', article('制造业采购经理指数（PMI）为49.8%，比上月上升0.6个百分点。'))[0];
assert.equal(pmi.value, 49.8);
assert.equal(pmi.change, 0.6);
assert.throws(() => parseOfficialMetricArticle('pmi', article('制造业采购经理指数（PMI）为149.8%，比上月上升0.6个百分点。')));
assert.throws(() => parseOfficialMetricArticle('pmi', article('没有有效指标')));
const fiscal = parseOfficialMetricArticle('fiscal', article('全国一般公共预算支出162889亿元，同比增长1.3%。国有土地使用权出让收入11731亿元，同比下降30.8%。国有土地使用权出让收入相关支出19474亿元，同比下降17.4%。', '2026-07'));
assert.deepEqual(fiscal.map(x => x.value), [1.3, -30.8]);
assert.equal(fiscal[0].period, '2026-01—07');
assert.equal(parseOfficialMetricArticle('property', article('新建商品房销售额42718亿元，下降13.1%。'))[0].value, -13.1);
assert.equal(parseOfficialMetricArticle('lpr', article('1年期LPR为3.0%，5年期以上LPR为3.5%。'))[0].display, '1Y 3.00% · 5Y+ 3.50%');

const listing = '<li><a href="./202608/t20260814_1.htm">2026年7月财政收支情况</a><span>2026-08-21</span></li><li><a href="./old.htm">2026年6月财政收支情况</a><span>2026-09-01</span></li>';
const selected = await latestOfficialArticle(officialLists.fiscal, /财政收支/, async url => url === officialLists.fiscal ? listing : '<p>正文</p>');
assert.equal(selected.period, '2026-07', '按统计期选择，不被置顶旧文误导');
assert.equal(selected.releasedAt, '2026-08-21', '不能把 URL 中日期当发布时间');
assert.equal(parseOfficialLinks('<a href="javascript:alert(1)">2026年8月中国采购经理指数运行情况</a>', officialLists.statistics).length, 0);

const fulfilled = value => ({ status: 'fulfilled', value });
const merge = createVerifiedMetricMerger([{ ...pmi, value: 999, display: '999' }]);
assert.equal(merge([]).get(pmi.id).value, null, '不允许种子数字冒充更新结果');
const good = merge([fulfilled(pmi)]).get(pmi.id);
assert.equal(good.freshness, 'checked');
const failed = merge([{ status: 'rejected', reason: Error('offline') }]).get(pmi.id);
assert.equal(failed.value, 49.8);
assert.equal(failed.freshness, 'cached');
assert.equal(failed.checkedAt, good.checkedAt, '失败不能刷新上次成功时间');
assert.equal(merge([fulfilled({ ...pmi, period: '2026-07', value: 49.2 })]).get(pmi.id).value, 49.8, '期数不能倒退');
assert.equal(merge([fulfilled({ ...pmi, value: NaN })]).get(pmi.id).freshness, 'cached');
assert.equal(merge([fulfilled({ ...pmi, period: '2026-09', value: 50 })]).get(pmi.id).value, 50);

const archive = { datasource: [{ showTitle: '我国进口月度增速连续6个月超过出口', publishUrl: '/fortune/20260908/example/c.html', publishTime: '2026-09-08 14:36:59' }] };
const mockRead = async url => url === officialLists.xinhua
  ? '<div id="content-list" data="datasource:abcdef"></div>'
  : url.endsWith('.json') ? JSON.stringify(archive)
    : '海关总署发布，2026年前8个月，我国货物贸易进出口总值34.78万亿元。我国出口20.17万亿元，同比增长14.6%。8月当月出口增长18.6%。';
const news = await fetchOfficialNews('xinhua', mockRead);
assert.equal(news[0].publishedAt, '2026-09-08T14:36:59+08:00');
const exports = await fetchExportMetric(mockRead);
assert.equal(exports.value, 14.6, '累计与单月不能混用');
assert.equal(exports.period, '2026-01—08');
assert.equal((await fetchExportMetric(async url => (await mockRead(url)).replace('同比增长14.6%', '同比下降14.6%'))).value, -14.6);
const ndrcListing = '<li><a href="./202609/t20260916_1407668.html">外贸“一枝独秀”，“三驾马车”如何协同发力？</a></li>';
const ndrcExports = await fetchExportMetric(async url => {
  if (url === officialLists.xinhua) throw new Error('新华社暂不可达');
  if (url === officialLists.ndrcTrade) return ndrcListing;
  return '2026年1~8月，我国货物贸易进出口总值34.78万亿元。其中出口20.17万亿元，增长14.6%；8月当月出口增长18.6%。';
});
assert.equal(ndrcExports.value, 14.6, '新华社不可达时应从发改委官方转载恢复累计出口');
assert.equal(ndrcExports.period, '2026-01—08');
assert.match(ndrcExports.source, /国家发展改革委/);
const alignedSpread = alignChinaUsTenYearSpread({ period: '2026-09-16', value: 1.6858 }, { period: '2026-09-15', value: 5 });
assert.equal(alignedSpread?.gapDays, 1);
assert.equal(alignedSpread?.value, -331.42);
assert.equal(alignChinaUsTenYearSpread({ period: '2026-09-16', value: 1.6858 }, { period: '2026-09-08', value: 5 }), null, '超过陈旧阈值不能拼接');
await assert.rejects(fetchOfficialNews('government', async () => '{}'));
const nbs = await fetchOfficialNews('statistics', async () => '<li><a href="./202609/t20260909_123.html">2026年8月份居民消费价格同比上涨0.8%</a><span>2026-09-09</span></li>');
assert.equal(nbs.length, 1, '官方标题不含中国两字也须保留');

const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
assert.ok(config.includes("url.searchParams.get('fresh') === '1'"));
assert.ok(!config.includes("value: 49.2, display: '49.2'"), '不得覆盖动态 PMI');
const component = readFileSync(new URL('../src/components/ChinaMacroCommandCenter.tsx', import.meta.url), 'utf8');
assert.ok(!component.includes('news.slice(0, 5)'));
assert.ok(component.includes('社融存量同比'));
console.log('China official sources: all assertions passed (periods, definitions, archives, safe failure, recovery, UI wiring).');
