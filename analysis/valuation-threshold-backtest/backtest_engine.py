from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys

import numpy as np
import pandas as pd
from scipy import stats


ROOT = Path(__file__).resolve().parent
INPUTS = ROOT / "inputs"
OUTPUTS = ROOT / "outputs"
GROUP_ORDER = ["低估", "合理", "高估"]
FIVE_GROUP_ORDER = ["极度低估", "低估", "合理", "高估", "极度高估"]


@dataclass(frozen=True)
class AnalysisConfig:
    lookback_years: int = 5
    minimum_history: int = 60
    horizons: tuple[int, ...] = (6, 12)
    current_cuts: tuple[int, int] = (35, 65)
    candidate_cuts: tuple[tuple[int, int], ...] = ((20, 80), (25, 75), (30, 70), (35, 65), (40, 60))
    bootstrap_iterations: int = 5_000
    seed: int = 20260916


def midrank_percentile(values: pd.Series, current: float) -> float:
    array = values.dropna().to_numpy(float)
    tolerance = 1e-9 * np.maximum.reduce([np.ones_like(array), np.abs(array), np.full_like(array, abs(current))])
    smaller = np.sum(array < current - tolerance)
    equal = np.sum(np.abs(array - current) <= tolerance)
    return float(100 * (smaller + 0.5 * equal) / len(array))


def label_three(percentile: float, low: int, high: int) -> str:
    if percentile <= low:
        return "低估"
    if percentile < high:
        return "合理"
    return "高估"


def label_five(percentile: float) -> str:
    if percentile < 10:
        return "极度低估"
    if percentile <= 35:
        return "低估"
    if percentile < 65:
        return "合理"
    if percentile <= 90:
        return "高估"
    return "极度高估"


def load_inputs() -> tuple[pd.DataFrame, pd.DataFrame]:
    pe = pd.read_csv(INPUTS / "pe_history.csv", parse_dates=["date"])
    prices = pd.read_csv(INPUTS / "etf_adjusted_close.csv", parse_dates=["date"])
    return pe, prices


def input_quality(pe: pd.DataFrame, prices: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for ticker in ("SPY", "QQQ"):
        group = pe[pe.ticker == ticker].sort_values("date")
        complete_months = pd.period_range(group.date.min(), group.date.max(), freq="M")
        rows.append({
            "dataset": f"{ticker} P/E（月度）", "rows": len(group),
            "first": group.date.min().date().isoformat(), "last": group.date.max().date().isoformat(),
            "duplicate_dates": int(group.date.duplicated().sum()), "missing_values": int(group.pe.isna().sum()),
            "covered_months": group.date.dt.to_period("M").nunique(), "expected_months": len(complete_months),
        })
        series = prices[["date", ticker]].dropna()
        rows.append({
            "dataset": f"{ticker} 复权收盘价（日度）", "rows": len(series),
            "first": series.date.min().date().isoformat(), "last": series.date.max().date().isoformat(),
            "duplicate_dates": int(series.date.duplicated().sum()), "missing_values": int(series[ticker].isna().sum()),
            "covered_months": series.date.dt.to_period("M").nunique(), "expected_months": len(pd.period_range(series.date.min(), series.date.max(), freq="M")),
        })
    return pd.DataFrame(rows)


def build_signals(pe: pd.DataFrame, prices: pd.DataFrame, config: AnalysisConfig) -> pd.DataFrame:
    records: list[dict[str, object]] = []
    for ticker in ("SPY", "QQQ"):
        fundamentals = pe[pe.ticker == ticker].sort_values("date").reset_index(drop=True)
        market = prices[["date", ticker]].dropna().sort_values("date").set_index("date")[ticker]
        market_dates = market.index
        for row in fundamentals.itertuples(index=False):
            start = row.date - pd.DateOffset(years=config.lookback_years)
            history = fundamentals[(fundamentals.date >= start) & (fundamentals.date <= row.date)]
            if len(history) < config.minimum_history or history.date.min() > start + pd.Timedelta(days=45):
                continue
            percentile = midrank_percentile(history.pe, float(row.pe))
            entry_pos = market_dates.searchsorted(row.date, side="right")
            if entry_pos >= len(market_dates):
                continue
            entry_date = market_dates[entry_pos]
            entry_price = float(market.iloc[entry_pos])
            for horizon in config.horizons:
                target = row.date + pd.DateOffset(months=horizon)
                exit_pos = market_dates.searchsorted(target, side="left")
                if exit_pos >= len(market_dates):
                    continue
                exit_date = market_dates[exit_pos]
                path = market.iloc[entry_pos:exit_pos + 1]
                drawdown = path / path.cummax() - 1
                records.append({
                    "ticker": ticker, "signal_date": row.date, "pe": float(row.pe),
                    "percentile": percentile, "horizon_months": horizon,
                    "entry_date": entry_date, "exit_date": exit_date,
                    "forward_return": float(market.iloc[exit_pos] / entry_price - 1),
                    "max_drawdown": float(drawdown.min()),
                    "year": int(row.date.year),
                })
    result = pd.DataFrame(records)
    low, high = config.current_cuts
    result["three_band"] = result.percentile.map(lambda value: label_three(value, low, high))
    result["five_band"] = result.percentile.map(label_five)
    return result


def distribution_summary(signals: pd.DataFrame, group_column: str, order: list[str]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for (ticker, horizon, group), sample in signals.groupby(["ticker", "horizon_months", group_column], observed=True):
        returns = sample.forward_return
        drawdowns = sample.max_drawdown
        rows.append({
            "ticker": ticker, "horizon_months": horizon, "group": group, "n": len(sample),
            "return_mean": returns.mean(), "return_median": returns.median(),
            "return_p25": returns.quantile(.25), "return_p75": returns.quantile(.75),
            "positive_rate": (returns > 0).mean(), "return_std": returns.std(ddof=1),
            "max_drawdown_mean": drawdowns.mean(), "max_drawdown_median": drawdowns.median(),
            "max_drawdown_p25": drawdowns.quantile(.25), "max_drawdown_p75": drawdowns.quantile(.75),
        })
    result = pd.DataFrame(rows)
    result["group"] = pd.Categorical(result.group, categories=order, ordered=True)
    return result.sort_values(["ticker", "horizon_months", "group"]).reset_index(drop=True)


def block_bootstrap_difference(sample: pd.DataFrame, group_a: str, group_b: str, group_column: str,
                               metric: str, iterations: int, seed: int) -> dict[str, float | int]:
    years = np.array(sorted(sample.year.unique()))
    observed = sample[sample[group_column] == group_a][metric].mean() - sample[sample[group_column] == group_b][metric].mean()
    if len(years) < 2 or not np.isfinite(observed):
        return {"difference": observed, "ci_low": np.nan, "ci_high": np.nan, "prob_positive": np.nan, "years": len(years)}
    rng = np.random.default_rng(seed)
    draws: list[float] = []
    by_year = {year: sample[sample.year == year] for year in years}
    for _ in range(iterations):
        boot = pd.concat([by_year[year] for year in rng.choice(years, size=len(years), replace=True)], ignore_index=True)
        a = boot[boot[group_column] == group_a][metric]
        b = boot[boot[group_column] == group_b][metric]
        if len(a) and len(b):
            draws.append(float(a.mean() - b.mean()))
    array = np.array(draws)
    return {
        "difference": float(observed), "ci_low": float(np.quantile(array, .025)) if len(array) else np.nan,
        "ci_high": float(np.quantile(array, .975)) if len(array) else np.nan,
        "prob_positive": float((array > 0).mean()) if len(array) else np.nan, "years": len(years),
    }


def current_rule_tests(signals: pd.DataFrame, config: AnalysisConfig) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for (ticker, horizon), sample in signals.groupby(["ticker", "horizon_months"]):
        low = sample[sample.three_band == "低估"]
        high = sample[sample.three_band == "高估"]
        for metric in ("forward_return", "max_drawdown"):
            boot = block_bootstrap_difference(sample, "低估", "高估", "three_band", metric,
                                              config.bootstrap_iterations, config.seed + horizon)
            mann = stats.mannwhitneyu(low[metric], high[metric], alternative="two-sided") if len(low) and len(high) else None
            rows.append({
                "ticker": ticker, "horizon_months": horizon, "metric": metric,
                "low_n": len(low), "high_n": len(high), **boot,
                "mann_whitney_p_naive": float(mann.pvalue) if mann else np.nan,
            })
        spearman = stats.spearmanr(sample.percentile, sample.forward_return)
        rows.append({
            "ticker": ticker, "horizon_months": horizon, "metric": "percentile_return_ic",
            "low_n": len(low), "high_n": len(high), "difference": float(spearman.statistic),
            "ci_low": np.nan, "ci_high": np.nan, "prob_positive": np.nan,
            "years": sample.year.nunique(), "mann_whitney_p_naive": float(spearman.pvalue),
        })
    return pd.DataFrame(rows)


def grid_search(signals: pd.DataFrame, config: AnalysisConfig) -> pd.DataFrame:
    detail: list[dict[str, object]] = []
    for low_cut, high_cut in config.candidate_cuts:
        labels = signals.percentile.map(lambda value: label_three(value, low_cut, high_cut))
        work = signals.assign(candidate_band=labels)
        for (ticker, horizon), sample in work.groupby(["ticker", "horizon_months"]):
            low = sample[sample.candidate_band == "低估"].forward_return
            high = sample[sample.candidate_band == "高估"].forward_return
            pooled = np.sqrt(((len(low) - 1) * low.var(ddof=1) + (len(high) - 1) * high.var(ddof=1)) / max(1, len(low) + len(high) - 2))
            detail.append({
                "low_cut": low_cut, "high_cut": high_cut, "ticker": ticker,
                "horizon_months": horizon, "low_n": len(low), "high_n": len(high),
                "low_return_mean": low.mean(), "high_return_mean": high.mean(),
                "mean_spread": low.mean() - high.mean(),
                "standardized_spread": (low.mean() - high.mean()) / pooled if pooled and np.isfinite(pooled) else np.nan,
            })
    detail_frame = pd.DataFrame(detail)
    ranking = detail_frame.groupby(["low_cut", "high_cut"], as_index=False).agg(
        average_spread=("mean_spread", "mean"),
        average_standardized_spread=("standardized_spread", "mean"),
        min_tail_n=("low_n", "min"),
        min_high_n=("high_n", "min"),
        positive_comparisons=("mean_spread", lambda values: int((values > 0).sum())),
    )
    ranking["min_tail_n"] = ranking[["min_tail_n", "min_high_n"]].min(axis=1)
    ranking = ranking.drop(columns="min_high_n").sort_values(
        ["positive_comparisons", "average_standardized_spread", "min_tail_n"], ascending=[False, False, False]
    )
    return detail_frame.merge(ranking.assign(rank=np.arange(1, len(ranking) + 1)), on=["low_cut", "high_cut"])


def extreme_tests(signals: pd.DataFrame, config: AnalysisConfig) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    comparisons = [("极度低估", "低估"), ("高估", "极度高估")]
    for (ticker, horizon), sample in signals.groupby(["ticker", "horizon_months"]):
        for group_a, group_b in comparisons:
            for metric in ("forward_return", "max_drawdown"):
                a = sample[sample.five_band == group_a][metric]
                b = sample[sample.five_band == group_b][metric]
                boot = block_bootstrap_difference(sample, group_a, group_b, "five_band", metric,
                                                  config.bootstrap_iterations, config.seed + horizon + len(group_a))
                mann = stats.mannwhitneyu(a, b, alternative="two-sided") if len(a) and len(b) else None
                rows.append({
                    "ticker": ticker, "horizon_months": horizon, "comparison": f"{group_a} − {group_b}",
                    "metric": metric, "group_a_n": len(a), "group_b_n": len(b), **boot,
                    "mann_whitney_p_naive": float(mann.pvalue) if mann else np.nan,
                })
    return pd.DataFrame(rows)


def run(config: AnalysisConfig = AnalysisConfig()) -> dict[str, pd.DataFrame]:
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    pe, prices = load_inputs()
    signals = build_signals(pe, prices, config)
    grid = grid_search(signals, config)
    grid_ranking = (
        grid[[
            "low_cut", "high_cut", "rank", "average_spread",
            "average_standardized_spread", "min_tail_n", "positive_comparisons",
        ]]
        .drop_duplicates()
        .sort_values("rank")
        .reset_index(drop=True)
    )
    outputs = {
        "data_quality": input_quality(pe, prices),
        "signals": signals,
        "current_rule_summary": distribution_summary(signals, "three_band", GROUP_ORDER),
        "current_rule_tests": current_rule_tests(signals, config),
        "grid_search": grid,
        "grid_ranking": grid_ranking,
        "five_band_summary": distribution_summary(signals, "five_band", FIVE_GROUP_ORDER),
        "extreme_tests": extreme_tests(signals, config),
    }
    for name, frame in outputs.items():
        frame.to_csv(OUTPUTS / f"{name}.csv", index=False)
    return outputs


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = run()
    for name, frame in result.items():
        print(f"\n## {name}\n{frame.to_string(index=False, max_rows=40)}")
