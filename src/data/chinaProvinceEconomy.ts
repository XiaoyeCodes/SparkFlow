export type ChinaProvinceEconomy = {
  name: string;
  shortName: string;
  gdpMillionCny: number;
  populationMillion: number;
  gdpPerCapitaCny: number;
  period: string;
};

const provinceRows = [
  ['北京市', '北京', 4_984_310, 228_167],
  ['天津市', '天津', 1_802_430, 132_143],
  ['河北省', '河北', 4_752_690, 64_352],
  ['山西省', '山西', 2_549_470, 73_769],
  ['内蒙古自治区', '内蒙古', 2_631_460, 110_011],
  ['辽宁省', '辽宁', 3_261_270, 78_236],
  ['吉林省', '吉林', 1_436_120, 61_689],
  ['黑龙江省', '黑龙江', 1_647_690, 54_102],
  ['上海市', '上海', 5_392_670, 217_140],
  ['江苏省', '江苏', 13_700_800, 160_694],
  ['浙江省', '浙江', 9_013_060, 135_565],
  ['安徽省', '安徽', 5_062_520, 82_694],
  ['福建省', '福建', 5_776_100, 137_920],
  ['江西省', '江西', 3_420_250, 75_862],
  ['山东省', '山东', 9_856_580, 97_575],
  ['河南省', '河南', 6_359_000, 64_888],
  ['湖北省', '湖北', 6_001_300, 102_832],
  ['湖南省', '湖南', 5_323_100, 81_225],
  ['广东省', '广东', 14_163_380, 111_146],
  ['广西壮族自治区', '广西', 2_864_940, 57_071],
  ['海南省', '海南', 793_570, 75_903],
  ['重庆市', '重庆', 3_219_320, 100_903],
  ['四川省', '四川', 6_469_700, 77_333],
  ['贵州省', '贵州', 2_266_710, 58_685],
  ['云南省', '云南', 3_153_410, 67_612],
  ['西藏自治区', '西藏', 276_490, 75_237],
  ['陕西省', '陕西', 3_553_880, 89_915],
  ['甘肃省', '甘肃', 1_300_290, 52_825],
  ['青海省', '青海', 395_080, 66_568],
  ['宁夏回族自治区', '宁夏', 550_280, 75_484],
  ['新疆维吾尔自治区', '新疆', 2_053_410, 78_660],
] as const;

export const CHINA_PROVINCE_ECONOMY = Object.fromEntries(provinceRows.map(([name, shortName, gdpMillionCny, gdpPerCapitaCny]) => [
  name,
  {
    name,
    shortName,
    gdpMillionCny,
    populationMillion: Number((gdpMillionCny / gdpPerCapitaCny).toFixed(2)),
    gdpPerCapitaCny,
    period: '2024',
  } satisfies ChinaProvinceEconomy,
])) as Record<string, ChinaProvinceEconomy>;

export const CHINA_PROVINCE_DATA_SOURCE = {
  label: '国家统计局国家数据 · 2024 年地区生产总值与人均地区生产总值',
  url: 'https://data.stats.gov.cn/easyquery.htm?cn=E0103',
};
