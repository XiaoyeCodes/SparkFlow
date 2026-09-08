"""Market bridge contracts, feed attribution and offline degradation without a broker."""
import asyncio
import importlib.util
import math
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("valuation_bridge", Path(__file__).resolve().parents[2] / "scripts" / "ibkr-valuation-snapshot.py")
BRIDGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BRIDGE)
REAL_SLEEP = asyncio.sleep


async def fast_sleep(_seconds):
    await REAL_SLEEP(0)


class Event:
    def __iadd__(self, _callback):
        return self


class FakeIB:
    instance = None
    fail_connect = False
    last = 123.4

    def __init__(self):
        FakeIB.instance = self
        self.errorEvent = Event()
        self.requests = []
        self.cancelled = []

    async def connectAsync(self, host, port, **kwargs):
        self.connection = (host, port, kwargs)
        if self.fail_connect:
            raise TimeoutError()

    async def qualifyContractsAsync(self, contract):
        return [contract]

    def reqMarketDataType(self, value):
        assert value == 3

    def reqMktData(self, contract, ticks, snapshot, regulatory_snapshot):
        assert ticks == "" and snapshot is False and regulatory_snapshot is False
        return SimpleNamespace(last=self.last, marketDataType=3, rtTime=datetime.now(timezone.utc), time=datetime.now(timezone.utc))

    def cancelMktData(self, contract):
        self.cancelled.append(contract.symbol)

    async def reqHistoricalDataAsync(self, contract, **kwargs):
        self.requests.append((contract, kwargs))
        end = kwargs["endDateTime"]
        stamp = date(end.year - 1, 12, 30) if end else datetime.now(timezone.utc).date()
        return [SimpleNamespace(date=stamp, close=120.5)]

    def disconnect(self):
        self.disconnected = True


def fake_index(symbol, exchange, currency):
    return SimpleNamespace(symbol=symbol, exchange=exchange, currency=currency, secType="IND", conId=1)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        FakeIB.fail_connect = False
        FakeIB.last = 123.4
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def run_bridge(self):
        sdk = SimpleNamespace(IB=FakeIB, Index=fake_index, StartupFetch=int)
        with patch.dict(sys.modules, {"ib_async": sdk}), patch.object(BRIDGE, "CACHE", Path(self.temp.name)), \
             patch.object(BRIDGE, "connection_settings", return_value=("127.0.0.1", 4001, 179)), \
             patch.object(BRIDGE.asyncio, "sleep", fast_sleep):
            return asyncio.run(BRIDGE.read_snapshot())

    def test_readonly_no_account_sync_exact_index_contracts_and_delayed_feed(self):
        payload = self.run_bridge()
        ib = FakeIB.instance
        self.assertEqual(ib.connection, ("127.0.0.1", 4001, {"clientId": 179, "timeout": 5, "readonly": True, "fetchFields": 0}))
        self.assertEqual(set(ib.cancelled), {"VIX", "SPX", "NDX"})
        for contract, kwargs in ib.requests:
            self.assertEqual(contract.secType, "IND")
            self.assertEqual(contract.exchange, "NASDAQ" if contract.symbol == "NDX" else "CBOE")
            self.assertEqual((kwargs["durationStr"], kwargs["barSizeSetting"], kwargs["whatToShow"]), ("1 Y", "1 day", "TRADES"))
        for item in payload["series"].values():
            self.assertEqual(item["status"], "delayed")
            self.assertEqual(item["current"], 123.4)
            self.assertTrue(item["source"].startswith("IBKR"))
        self.assertTrue(ib.disconnected)

    def test_missing_quote_uses_only_actual_history_and_marks_close(self):
        FakeIB.last = math.nan
        payload = self.run_bridge()
        for item in payload["series"].values():
            self.assertEqual(item["status"], "close")
            self.assertEqual(item["current"], 120.5)
            self.assertEqual(item["asOf"], date.today().isoformat())

    def test_gateway_failure_never_creates_values(self):
        FakeIB.fail_connect = True
        payload = self.run_bridge()
        for item in payload["series"].values():
            self.assertEqual(item["status"], "missing")
            self.assertIsNone(item["current"])
            self.assertEqual(item["points"], [])
            self.assertIn("4001", item["note"])


if __name__ == "__main__":
    unittest.main()
