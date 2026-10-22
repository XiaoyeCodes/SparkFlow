"""Synthetic / explicit offline tests; fixtures are never used by production jobs."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from datetime import date
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import worker
from treasury import observations, holiday_context
from lxml import html


class BridgeTests(unittest.TestCase):
    def test_treasury_named_maturity_columns_and_actual_date(self):
        raw = b'<table><tr><th>Date</th><th>2 Yr</th><th>10 Yr</th><th>30 Yr</th></tr><tr><td>10/21/2026</td><td>2.13</td><td>4.51</td><td>5.2</td></tr><tr><td>10/20/2026</td><td>2.1</td><td>4.50</td><td>5.1</td></tr><tr><td>10/23/2026</td><td>8</td><td>9</td><td>10</td></tr></table>'
        rows = observations(raw, date(2026, 10, 22))
        self.assertEqual([d.isoformat() for d, _ in rows], ['2026-10-21', '2026-10-20'])
        self.assertEqual(str(rows[0][1]), '4.51')

    def test_conflicting_official_rows_rejected(self):
        raw = b'<table><tr><th>Date</th><th>10 Yr</th></tr><tr><td>10/21/2026</td><td>4</td></tr><tr><td>10/21/2026</td><td>5</td></tr></table>'
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            observations(raw, date(2026, 10, 22))

    def test_year_in_footer_is_not_a_verified_holiday_schedule(self):
        with self.assertRaises(ValueError):
            holiday_context(b'<html><footer>2026</footer><p>Holiday falls on a Saturday</p></html>', [2026])

    def test_date_mismatch_never_becomes_successful_daily60_bundle(self):
        sys.path.insert(0, str(ROOT/'skills/generate-daily60-digest/scripts'))
        import daily60
        with patch.object(daily60, 'fetch', return_value=({'date': '1900-01-01', 'news': ['old']}, 'https://example.com', [], 'sha')), patch.object(daily60, 'fetch_calendar', return_value={}):
            with self.assertRaises(ValueError):
                worker.generate('daily60', '2026-10-22', Path('unused'))


if __name__ == '__main__':
    unittest.main()
