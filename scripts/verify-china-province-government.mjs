import assert from 'node:assert/strict';
import {
  CHINA_PROVINCE_ECONOMY,
  createChinaProvinceOfficialFallback,
  rankChinaOfficialNews,
} from '../src/data/chinaProvinceEconomy.ts';

const expectedRegions = [
  '北京市', '天津市', '河北省', '山西省', '内蒙古自治区',
  '辽宁省', '吉林省', '黑龙江省', '上海市', '江苏省',
  '浙江省', '安徽省', '福建省', '江西省', '山东省',
  '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区',
  '海南省', '重庆市', '四川省', '贵州省', '云南省',
  '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区',
  '新疆维吾尔自治区',
];

const actualRegions = Object.keys(CHINA_PROVINCE_ECONOMY);
assert.deepEqual(actualRegions, expectedRegions, '省级档案必须完整覆盖大陆 31 个省级行政区');

for (const province of expectedRegions) {
  const profile = CHINA_PROVINCE_ECONOMY[province];
  const portal = new URL(profile.governmentUrl);
  assert.equal(portal.protocol, 'https:', `${province}政府门户必须使用 HTTPS`);
  assert.match(portal.hostname, /\.gov\.cn$/, `${province}政府门户必须属于 gov.cn 官方域名`);

  for (const mode of ['policy', 'news']) {
    const fallback = createChinaProvinceOfficialFallback(province, mode);
    assert.equal(fallback.fallback, true, `${province} ${mode} 必须提供明确的官方降级入口`);
    assert.equal(fallback.url, profile.governmentUrl, `${province} ${mode} 降级入口必须回到本省官方门户`);
    assert.match(fallback.title, new RegExp(`^${province}人民政府`));
  }
}

const rankedNews = rankChinaOfficialNews([
  { id: 'routine-1', title: '本周政务服务窗口工作安排', source: '测试', url: 'https://example.gov.cn/1' },
  { id: 'economy', title: '全省经济运行和重点产业项目推进情况发布', source: '测试', url: 'https://example.gov.cn/2' },
  { id: 'livelihood', title: '教育医疗养老等民生服务持续改善', source: '测试', url: 'https://example.gov.cn/3' },
  { id: 'decision', title: '省委召开会议审议政府工作报告', source: '测试', url: 'https://example.gov.cn/4' },
  { id: 'safety', title: '启动防汛应急响应并部署安全生产工作', source: '测试', url: 'https://example.gov.cn/5' },
  { id: 'policy', title: '新条例实施方案正式印发', source: '测试', url: 'https://example.gov.cn/6' },
  { id: 'routine-2', title: '部门举行日常工作交流会', source: '测试', url: 'https://example.gov.cn/7' },
  { id: 'fallback', title: '人民政府政务动态入口', source: '测试', url: 'https://example.gov.cn/8', fallback: true },
]);

assert.equal(rankedNews.length, 6, '地方新闻最多显示 6 条');
assert.equal(rankedNews[0].id, 'decision', '政府重大决策应排在最前');
assert.ok(rankedNews[0].highlights?.includes('省委'), '排序结果必须携带可展示的重点词');
assert.ok(!rankedNews.some((item) => item.id === 'fallback'), '有足够正式新闻时不应让降级入口占用前六名');

console.log(`中国省级政务信息覆盖校验通过：${actualRegions.length}/31 个地区，政策与新闻降级入口 ${actualRegions.length * 2}/62 个；新闻权重排序与 6 条上限有效。`);
