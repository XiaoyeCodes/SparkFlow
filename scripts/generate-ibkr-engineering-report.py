from datetime import datetime, timezone
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services' / 'vibe-trading' / 'agent'))

from src.ibkr_terminal.reports import build_account_report
from src.ibkr_terminal.schemas import Snapshot


snapshot = Snapshot.model_validate_json((ROOT / 'tests' / 'ibkr' / 'fixtures' / 'risk-report-snapshot.json').read_text(encoding='utf-8'))
report = build_account_report(snapshot, ROOT / 'output' / 'pdf' / 'ibkr-terminal-engineering-risk-report',
    now=datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc))
print(json.dumps({key: str(value) for key, value in report.files.items()}, ensure_ascii=False))
