"""Create or validate/restore a local SparkFlow IBKR runtime backup."""
from argparse import ArgumentParser
from datetime import datetime, timezone
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services' / 'vibe-trading' / 'agent'))

from src.ibkr_terminal.maintenance import backup_runtime, restore_runtime, validate_backup  # noqa: E402


def main():
    parser = ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    backup = commands.add_parser('backup'); backup.add_argument('--runtime', type=Path, required=True); backup.add_argument('--output', type=Path, required=True)
    validate = commands.add_parser('validate'); validate.add_argument('--backup', type=Path, required=True)
    restore = commands.add_parser('restore'); restore.add_argument('--backup', type=Path, required=True); restore.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'backup':
        result = backup_runtime(args.runtime, args.output, created_at=datetime.now(timezone.utc).isoformat())
    elif args.command == 'validate':
        result = validate_backup(args.backup)
    else:
        result = restore_runtime(args.backup, args.output)
    print(json.dumps({'ok': True, 'command': args.command, 'files': len(result['files']), 'createdAt': result['createdAt']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
