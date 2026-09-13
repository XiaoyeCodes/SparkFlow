import importlib.util
import unittest
from pathlib import Path

import pandas as pd

spec = importlib.util.spec_from_file_location('regional', Path(__file__).with_name('refresh_china_regional_economy.py'))
regional = importlib.util.module_from_spec(spec)
spec.loader.exec_module(regional)


class RegionalTables(unittest.TestCase):
    registry = {
        '110101': {'name': '东城区', 'level': 'county'},
        '110102': {'name': '西城区', 'level': 'county'},
        '110103': {'name': '测试区', 'level': 'county'},
    }

    def parse(self, rows, title='常住人口（2023-2024年）'):
        return regional.parse_table(pd.DataFrame(rows), title, 'https://tjj.example.gov.cn/table.xls', '11', self.registry)

    def test_latest_year_and_unit(self):
        result = self.parse([
            ['常住人口（2023-2024年）', None, None], ['单位：万人', None, None],
            ['地区', 2023, 2024], ['东城区', 70.3, 70.1], ['西城区', 109.9, None]])
        self.assertEqual([(x['adcode'], x['value'], x['period']) for x in result], [('110101', .701, '2024')])

    def test_html_merged_title_is_not_a_column_label(self):
        title = '各区常住人口及人口密度（2024）'
        result = self.parse([[title] * 3, ['地区', '年末常住人口', '人口密度'],
                             [None, '万人', '人/平方公里'], ['东城区', 70.1, 24604]], title)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['value'], .701)

    def test_gdp_and_per_capita_units_not_growth(self):
        result = self.parse([
            ['各区主要经济指标（2024年）', None, None, None],
            ['地区', '地区生产总值（万元）', '人均地区生产总值（元）', 'GDP增长（%）'],
            ['东城区', 3000000, 110000, 5.2]], '各区主要经济指标（2024年）')
        self.assertEqual({x['metric']: x['value'] for x in result}, {'gdp': 300, 'perCapita': 110000})

    def test_registered_population_is_not_resident(self):
        result = self.parse([['各区户籍人口（2024）', None], ['地区', '户籍人口（万人）'], ['东城区', 70.1]], '各区户籍人口（2024）')
        self.assertEqual(result, [])

    def test_duplicate_region_requires_parent(self):
        registry = {**self.registry, '110104': {'name': '东城区', 'level': 'county'}}
        result = regional.parse_table(pd.DataFrame([
            ['各区GDP（2024）', None], ['地区', '地区生产总值（亿元）'], ['东城区', 300]]),
            '各区GDP（2024）', 'https://tjj.example.gov.cn/table.xls', '11', registry)
        self.assertEqual(result, [])

    def test_multi_block_table(self):
        rows = [['各区生产总值（2024年）', None, None, None],
                ['地区', '生产总值（亿元）', '地区', '生产总值（亿元）']]
        rows += [[name, value, name, value] for name, value in [('东城区', 300), ('西城区', 400), ('测试区', 500)]]
        result = self.parse(rows, '各区生产总值（2024年）')
        self.assertEqual([x['value'] for x in result], [300, 400, 500] * 2)


if __name__ == '__main__':
    unittest.main()
