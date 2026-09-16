from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import numpy as np
import pandas as pd


MODULE_PATH = Path(__file__).with_name("backtest_engine.py")
SPEC = importlib.util.spec_from_file_location("valuation_backtest_engine", MODULE_PATH)
engine = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = engine
SPEC.loader.exec_module(engine)


def test_midrank_percentile_handles_ties() -> None:
    values = pd.Series([1.0, 2.0, 2.0, 4.0])
    assert engine.midrank_percentile(values, 2.0) == 50.0


def test_band_boundaries_match_ui_rules() -> None:
    assert engine.label_three(35.0, 35, 65) == "低估"
    assert engine.label_three(35.01, 35, 65) == "合理"
    assert engine.label_three(65.0, 35, 65) == "高估"
    assert engine.label_five(9.99) == "极度低估"
    assert engine.label_five(10.0) == "低估"
    assert engine.label_five(90.0) == "高估"
    assert engine.label_five(90.01) == "极度高估"


def test_signals_enter_after_observation_and_use_future_path() -> None:
    dates = pd.date_range("2015-01-31", periods=85, freq="ME")
    pe = pd.concat([
        pd.DataFrame({"date": dates, "ticker": ticker, "pe": np.linspace(15, 25, len(dates))})
        for ticker in ("SPY", "QQQ")
    ], ignore_index=True)
    market_dates = pd.bdate_range("2014-12-01", "2023-12-31")
    prices = pd.DataFrame({
        "date": market_dates,
        "SPY": np.linspace(100, 200, len(market_dates)),
        "QQQ": np.linspace(100, 240, len(market_dates)),
    })

    signals = engine.build_signals(pe, prices, engine.AnalysisConfig(bootstrap_iterations=10))

    assert not signals.empty
    assert (signals.entry_date > signals.signal_date).all()
    assert (signals.exit_date > signals.entry_date).all()
    assert (signals.forward_return > 0).all()
    assert (signals.max_drawdown <= 0).all()
