export type ChinaProvinceEconomy = {
  name: string;
  shortName: string;
  gdpMillionCny: number;
  populationMillion: number;
  gdpPerCapitaCny: number;
  urbanizationPercent: number;
  birthRatePermille: number;
  naturalGrowthRatePermille: number;
  elderlyDependencyPercent: number;
  fiscalRevenue100mCny: number;
  fiscalExpenditure100mCny: number;
  fiscalSelfSufficiencyPercent: number;
  governmentUrl: string;
  period: string;
};

type ProvinceRow = readonly [
  name: string,
  shortName: string,
  gdpMillionCny: number,
  gdpPerCapitaCny: number,
  population10k: number,
  urbanizationPercent: number,
  birthRatePermille: number,
  naturalGrowthRatePermille: number,
  elderlyDependencyPercent: number,
  fiscalRevenue100mCny: number,
  fiscalExpenditure100mCny: number,
  governmentUrl: string,
];

const provinceRows: ProvinceRow[] = [
  ['北京市', '北京', 4_984_310, 228_167, 2183, 88.22, 6.09, 0.01, 23.03, 6372.68, 8396.49, 'https://www.beijing.gov.cn/'],
  ['天津市', '天津', 1_802_430, 132_143, 1364, 86.01, 4.99, -1.97, 26.79, 2134.20, 3627.18, 'https://www.tj.gov.cn/'],
  ['河北省', '河北', 4_752_690, 64_352, 7378, 63.42, 5.90, -2.32, 24.72, 4310.85, 10326.72, 'https://www.hebei.gov.cn/'],
  ['山西省', '山西', 2_549_470, 73_769, 3446, 66.32, 6.94, -1.39, 22.66, 3542.24, 6312.67, 'https://www.shanxi.gov.cn/'],
  ['内蒙古自治区', '内蒙古', 2_631_460, 110_011, 2388, 70.73, 5.52, -2.84, 22.44, 3150.57, 6916.71, 'https://www.nmg.gov.cn/'],
  ['辽宁省', '辽宁', 3_261_270, 78_236, 4155, 74.18, 4.32, -5.30, 32.09, 2906.94, 6860.03, 'https://www.ln.gov.cn/'],
  ['吉林省', '吉林', 1_436_120, 61_689, 2317, 65.78, 4.17, -4.85, 27.47, 1191.39, 4672.94, 'https://www.jl.gov.cn/'],
  ['黑龙江省', '黑龙江', 1_647_690, 54_102, 3029, 68.05, 3.35, -6.34, 26.88, 1452.34, 6454.54, 'https://www.hlj.gov.cn/'],
  ['上海市', '上海', 5_392_670, 217_140, 2480, 89.85, 4.75, -1.53, 28.83, 8374.17, 9874.84, 'https://www.shanghai.gov.cn/'],
  ['江苏省', '江苏', 13_700_800, 160_694, 8526, 75.53, 4.98, -2.50, 27.52, 10038.16, 15293.57, 'https://www.jiangsu.gov.cn/'],
  ['浙江省', '浙江', 9_013_060, 135_565, 6670, 75.46, 6.17, -0.36, 21.83, 8707.57, 12564.65, 'https://www.zj.gov.cn/'],
  ['安徽省', '安徽', 5_062_520, 82_694, 6123, 62.57, 6.17, -2.24, 23.17, 4041.64, 8999.54, 'https://www.ah.gov.cn/'],
  ['福建省', '福建', 5_776_100, 137_920, 4193, 71.80, 6.95, 0.24, 18.55, 3615.29, 6080.93, 'https://www.fujian.gov.cn/'],
  ['江西省', '江西', 3_420_250, 75_862, 4502, 63.77, 6.65, -0.58, 20.35, 3066.92, 7695.25, 'https://www.jiangxi.gov.cn/'],
  ['山东省', '山东', 9_856_580, 97_575, 10080, 66.48, 6.42, -1.67, 27.08, 7711.74, 13077.19, 'https://www.shandong.gov.cn/'],
  ['河南省', '河南', 6_359_000, 64_888, 9785, 59.22, 7.78, -0.11, 22.92, 4392.67, 11464.16, 'https://www.henan.gov.cn/'],
  ['湖北省', '湖北', 6_001_300, 102_832, 5834, 66.35, 5.38, -3.14, 25.28, 3937.88, 9976.31, 'https://www.hubei.gov.cn/'],
  ['湖南省', '湖南', 5_323_100, 81_225, 6539, 62.07, 5.89, -3.04, 25.00, 3449.27, 9536.26, 'https://www.hunan.gov.cn/'],
  ['广东省', '广东', 14_163_380, 111_146, 12780, 75.91, 8.89, 3.69, 14.09, 13533.98, 17956.06, 'https://www.gd.gov.cn/'],
  ['广西壮族自治区', '广西', 2_864_940, 57_071, 5013, 57.39, 8.37, 0.88, 21.39, 1837.32, 6469.58, 'https://www.gxzf.gov.cn/'],
  ['海南省', '海南', 793_570, 75_903, 1048, 63.08, 9.37, 3.06, 16.85, 890.51, 2293.21, 'https://www.hainan.gov.cn/'],
  ['重庆市', '重庆', 3_219_320, 100_903, 3190, 72.14, 5.99, -2.88, 27.88, 2595.55, 5621.21, 'https://www.cq.gov.cn/'],
  ['四川省', '四川', 6_469_700, 77_333, 8364, 60.10, 6.41, -3.02, 27.29, 5635.60, 13447.16, 'https://www.sc.gov.cn/'],
  ['贵州省', '贵州', 2_266_710, 58_685, 3860, 56.65, 10.74, 3.00, 19.79, 2170.00, 6524.74, 'https://www.guizhou.gov.cn/'],
  ['云南省', '云南', 3_153_410, 67_612, 4655, 54.11, 8.62, 0.17, 17.22, 2193.68, 6862.92, 'https://www.yn.gov.cn/'],
  ['西藏自治区', '西藏', 276_490, 75_237, 370, 39.68, 13.87, 8.43, 9.01, 277.19, 2919.62, 'https://www.xizang.gov.cn/'],
  ['陕西省', '陕西', 3_553_880, 89_915, 3953, 66.14, 7.36, -0.69, 22.95, 3393.28, 7297.73, 'https://www.shaanxi.gov.cn/'],
  ['甘肃省', '甘肃', 1_300_290, 52_825, 2458, 56.83, 8.00, -0.90, 19.92, 1051.89, 4784.67, 'https://www.gansu.gov.cn/'],
  ['青海省', '青海', 395_080, 66_568, 593, 63.86, 10.11, 2.70, 15.10, 370.45, 2164.05, 'https://www.qinghai.gov.cn/'],
  ['宁夏回族自治区', '宁夏', 550_280, 75_484, 729, 68.22, 10.97, 4.52, 15.12, 516.59, 1768.50, 'https://www.nx.gov.cn/'],
  ['新疆维吾尔自治区', '新疆', 2_053_410, 78_660, 2623, 60.36, 9.42, 3.37, 12.31, 2409.69, 7645.96, 'https://www.xinjiang.gov.cn/'],
];

export const CHINA_PROVINCE_ECONOMY = Object.fromEntries(provinceRows.map(([
  name,
  shortName,
  gdpMillionCny,
  gdpPerCapitaCny,
  population10k,
  urbanizationPercent,
  birthRatePermille,
  naturalGrowthRatePermille,
  elderlyDependencyPercent,
  fiscalRevenue100mCny,
  fiscalExpenditure100mCny,
  governmentUrl,
]) => [
  name,
  {
    name,
    shortName,
    gdpMillionCny,
    populationMillion: population10k / 100,
    gdpPerCapitaCny,
    urbanizationPercent,
    birthRatePermille,
    naturalGrowthRatePermille,
    elderlyDependencyPercent,
    fiscalRevenue100mCny,
    fiscalExpenditure100mCny,
    fiscalSelfSufficiencyPercent: Number((fiscalRevenue100mCny / fiscalExpenditure100mCny * 100).toFixed(1)),
    governmentUrl,
    period: '2024',
  } satisfies ChinaProvinceEconomy,
])) as Record<string, ChinaProvinceEconomy>;

export const CHINA_PROVINCE_DATA_SOURCES = {
  economy: {
    label: '国家统计局《中国统计年鉴 2025》表 3-9 · 地区生产总值（2024年）',
    url: 'https://www.stats.gov.cn/sj/ndsj/2025/html/C03-09.jpg',
  },
  population: {
    label: '国家统计局《中国统计年鉴 2025》表 2-7、2-11 · 分地区人口（2024年）',
    url: 'https://www.stats.gov.cn/sj/ndsj/2025/html/C02-07.jpg',
  },
  fiscal: {
    label: '国家统计局《中国统计年鉴 2025》表 7-5、7-6 · 分地区一般公共预算收支（2024年）',
    url: 'https://www.stats.gov.cn/sj/ndsj/2025/html/C07-05.jpg',
  },
} as const;

export const CHINA_PROVINCE_DATA_SOURCE = CHINA_PROVINCE_DATA_SOURCES.economy;
