import assert from 'node:assert/strict';
import { rankChinaMacroNews } from '../src/lib/chinaMacroNews.ts';

const ranked = rankChinaMacroNews([
  { id: 'routine', title: '常规行业交流活动举行', importanceScore: 61, publishedAt: '2026-09-13T12:00:00Z' },
  { id: 'policy', title: '国务院部署资本市场重大改革', importanceScore: 96, publishedAt: '2026-09-12T12:00:00Z' },
  { id: 'macro-old', title: '国家统计局发布8月CPI数据', importanceScore: 88, publishedAt: '2026-09-11T12:00:00Z' },
  { id: 'macro-new', title: '国家统计局发布8月工业增加值数据', importanceScore: 88, publishedAt: '2026-09-13T08:00:00Z' },
  { id: 'safety', title: '启动地震应急响应', importanceScore: 91, publishedAt: '2026-09-13T09:00:00Z' },
  { id: 'market', title: '人民币汇率与A股市场运行情况', importanceScore: 82, publishedAt: '2026-09-13T07:00:00Z' },
  { id: 'livelihood', title: '就业医疗养老民生政策发布', importanceScore: 78, publishedAt: '2026-09-13T06:00:00Z' },
  { id: 'extra', title: '区域消费情况观察', importanceScore: 70, publishedAt: '2026-09-13T13:00:00Z' },
]);

assert.equal(ranked.length, 6, '全国要闻最多返回 6 条');
assert.equal(ranked[0].id, 'policy', '重要性分数必须是第一排序条件');
assert.ok(ranked[0].highlights.includes('国务院'), '必须返回可展示的重点词');
assert.ok(ranked[0].highlights.includes('资本市场'), '重点词应覆盖宏观金融主题');
assert.ok(ranked.findIndex((item) => item.id === 'macro-new') < ranked.findIndex((item) => item.id === 'macro-old'), '同分新闻按发布时间由新到旧排列');
assert.ok(!ranked.some((item) => item.id === 'routine'), '低权重新闻不应进入前六条');

console.log('中国宏观要闻校验通过：重要性优先、同分按时间、重点词标注、最多 6 条。');
