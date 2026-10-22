#!/usr/bin/env python3
"""Offline agent-tool bridge. Initializes requests; never fetches or invents quotes.

The agent calls its available read-only connector/web tools, retains their raw
responses, then supplies the documented JSON contract. Validation is deliberately
separate from collection. A passing hash proves retained bytes, not source truth.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from decimal import InvalidOperation
import json
from pathlib import Path
import sys
from uuid import uuid4
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import market_module

VERSION = "jin10-agent-quotes/1"
MAX_RUN_AGE = 1200
CLOCK_SKEW = 5
ASSETS = {
    "COMP": {"instrument_id": "NASDAQ:COMP:PRICE_INDEX", "calendar_id": "NASDAQ", "contract": [18342287, "NASDAQ", "IND"]},
    "SPX": {"instrument_id": "SPDJI:SPX:PRICE_INDEX", "calendar_id": "CBOE_SPX", "contract": [416904, "CBOE", "IND"]},
    "MAGS": {"instrument_id": "CBOE_BZX:MAGS:ETF", "calendar_id": "CBOE_BZX", "contract": [624756922, "SMART", "STK"]},
    "SSE": {"instrument_id": "SSE:000001:PRICE_INDEX", "calendar_id": "SSE"},
    "HSI": {"instrument_id": "HSI:HSI:PRICE_INDEX", "calendar_id": "HKEX", "contract": [1328298, "HKFE", "IND"]},
    "BTCUSD": {"instrument_id": "PAXOS:BTCUSD:SPOT", "calendar_id": "PAXOS", "contract": [479624278, "PAXOS", "CRYPTO"]},
    "XAUUSD": {"instrument_id": "LONDON:XAUUSD:SPOT_MIDPOINT", "calendar_id": "IBKR_GOLD", "contract": [69067924, "SMART", "CMDTY"]},
    "BRENT": {"instrument_id": "ICE:BRENT:FRONT_FUTURE", "calendar_id": "ICE_BRENT"},
    "US10Y": {"instrument_id": "UST:CMT:10Y", "calendar_id": "US_TREASURY"},
}
CALENDAR_DOMAINS = {
    "NASDAQ": ("nasdaq.com",), "CBOE_SPX": ("cboe.com",),
    "CBOE_BZX": ("cboe.com",), "SSE": ("sse.com.cn",),
    "HKEX": ("hkex.com.hk",), "PAXOS": ("paxos.com", "interactivebrokers.com"),
    "IBKR_GOLD": ("interactivebrokers.com",), "ICE_BRENT": ("ice.com",),
    "US_TREASURY": ("home.treasury.gov", "treasury.gov", "opm.gov"),
}
CALENDAR_TIMEZONES = {
    "NASDAQ": "America/New_York", "CBOE_SPX": "America/New_York", "CBOE_BZX": "America/New_York",
    "SSE": "Asia/Shanghai", "HKEX": "Asia/Hong_Kong", "PAXOS": "Etc/UTC",
    "IBKR_GOLD": "America/New_York", "ICE_BRENT": "Europe/London", "US_TREASURY": "America/New_York",
}
EQUITIES = {"COMP", "SPX", "MAGS", "SSE", "HSI"}


class ContractError(ValueError):
    """A run cannot be delivered as current market data."""


def require(condition, message):
    if not condition:
        raise ContractError(message)


def utc_now():
    return datetime.now(timezone.utc)


def stamp(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def timestamp(value):
    require(isinstance(value, str), "Timestamp must be an ISO-8601 string")
    try:
        return market_module.dt(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise ContractError("Invalid timezone-aware timestamp: " + str(value)) from exc


def day(value):
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError) as exc:
        raise ContractError("Invalid ISO session date") from exc


def write_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ContractError(f"Cannot read JSON file {path.name}: {exc}") from exc


def file_hash(path):
    return sha256(path.read_bytes()).hexdigest()


def safe_file(root, name):
    require(isinstance(name, str) and name and not Path(name).is_absolute(), "Evidence paths must be nonempty relative paths")
    p = (root / name).resolve()
    require(p.is_relative_to(root.resolve()), "Evidence path escapes run directory")
    require(p.is_file(), "Missing evidence file: " + name)
    return p


def public_url(url):
    try:
        market_module.safe_link(url)
    except (TypeError, ValueError) as exc:
        raise ContractError("Evidence needs a public HTTPS source URL") from exc
    return urlsplit(url).hostname


def init_run(root, now=None):
    """Production CLI always uses current UTC; now exists only for unit tests."""
    now = now or utc_now()
    root = Path(root)
    require(not root.exists() or not any(root.iterdir()), "Refusing to overwrite an existing run; choose a new empty directory")
    root.mkdir(parents=True, exist_ok=True)
    (root / "evidence").mkdir()
    request = {
        "schema": VERSION, "run_id": str(uuid4()), "run_started_at": stamp(now),
        "report_timezone": "Asia/Shanghai", "freshness_limit_seconds": MAX_RUN_AGE,
        "required_assets": [{"id": key, "name": name, "unit": unit, "baseline": baseline, **ASSETS[key]}
                            for key, name, unit, baseline in market_module.ASSETS],
        "instruction": "Use fresh available read-only agent tools now. No quote values are provided. Read references/market-input-contract.md. Never relabel an older run.",
    }
    write_json(root / "request.json", request)
    binding = {"schema": VERSION, "run_id": request["run_id"], "request_sha256": file_hash(root / "request.json")}
    quotes = {**binding, "collected_at": None, "quotes": [
        {"id": row["id"], "run_id": request["run_id"], "status": "pending", "unit": row["unit"],
         "baseline": row["baseline"], "instrument_id": row["instrument_id"], "calendar_id": row["calendar_id"],
         "reason": "Awaiting fresh source retrieval and verified calendar"} for row in request["required_assets"]]}
    write_json(root / "quotes.json", quotes)
    write_json(root / "calendar.json", {**binding, "evaluated_at": None, "calendars": []})
    write_json(root / "evidence" / "manifest.json", {**binding, "run_started_at": request["run_started_at"], "collection_finished_at": None, "queries": []})
    return request


def check_binding(obj, request, digest, label):
    require(obj.get("schema") == VERSION, label + " schema mismatch")
    require(obj.get("run_id") == request["run_id"], label + " belongs to another run")
    require(obj.get("request_sha256") == digest, label + " request hash mismatch")


def check_manifest(root, manifest, started, collected):
    require(timestamp(manifest["run_started_at"]) == started, "Manifest start does not match request")
    require(timestamp(manifest["collection_finished_at"]) == collected, "Manifest finish does not match snapshot")
    require(isinstance(manifest.get("queries"), list), "Manifest queries must be a list")
    entries, keys = {}, set()
    for entry in manifest["queries"]:
        require(isinstance(entry, dict), "Manifest query must be an object")
        require(entry.get("run_id") == manifest["run_id"], "Evidence query lacks current run binding")
        key = entry.get("key")
        require(isinstance(key, str) and key and key not in keys, "Missing or duplicate evidence query key")
        keys.add(key)
        require(isinstance(entry.get("tool"), str) and entry["tool"], "Record actual available tool name")
        require(isinstance(entry.get("args"), dict), "Retain exact tool query arguments")
        require(isinstance(entry.get("source_urls"), list) and entry["source_urls"], "Record verified source URLs")
        for url in entry["source_urls"]:
            public_url(url)
        requested, fetched = timestamp(entry["requested_at"]), timestamp(entry["fetched_at"])
        require(started <= requested <= fetched <= collected + timedelta(seconds=CLOCK_SKEW), "Evidence was not retrieved during this run")
        name = entry["evidence_file"]
        require(name not in entries, "An evidence file must identify one preserved call response")
        require(file_hash(safe_file(root, name)) == entry.get("evidence_sha256"), "Raw evidence hash mismatch")
        entries[name] = entry
    return entries


def evidence_ref(root, obj, prefix, entries):
    name = obj.get(prefix + "file")
    digest = obj.get(prefix + "sha256")
    require(name in entries, "Evidence not bound to a current-run query: " + str(name))
    require(entries[name]["evidence_sha256"] == digest == file_hash(safe_file(root, name)), "Evidence reference/hash mismatch")
    return entries[name]


def calendar_facts(cal, root, entries, collected):
    cid = cal.get("calendar_id")
    require(cid in CALENDAR_DOMAINS, "Unknown calendar")
    require(cal.get("timezone") == CALENDAR_TIMEZONES[cid], "Calendar timezone does not match this benchmark")
    tz = ZoneInfo(cal["timezone"])
    today = collected.astimezone(tz).date()
    roles = set()
    for source in cal.get("sources", []):
        require(isinstance(source, dict), "Calendar source must be an object")
        host = public_url(source.get("url"))
        require(any(host == domain or host.endswith("." + domain) for domain in CALENDAR_DOMAINS[cid]), "Calendar source is not the relevant official authority")
        entry = evidence_ref(root, source, "evidence_", entries)
        require(source["url"] in entry["source_urls"], "Calendar URL missing from retained query sources")
        require(isinstance(source.get("roles"), list), "Calendar source roles missing")
        roles.update(source["roles"])
    mode = cal.get("mode")
    require(mode in ("sessions", "continuous", "publication"), "Unknown calendar mode")
    require((cid == "PAXOS") == (mode == "continuous"), "Only Paxos BTC uses continuous calendar mode")
    require((cid == "US_TREASURY") == (mode == "publication"), "Only Treasury CMT uses publication calendar mode")
    required_roles = {"hours", "holidays", "exceptions"} if mode == "sessions" else ({"hours", "exceptions"} if mode == "continuous" else {"publication", "holidays", "exceptions"})
    require(required_roles <= roles, "Current official hours/holiday/exception/publication evidence is incomplete")
    years = cal.get("years")
    require(isinstance(years, list) and all(type(y) is int for y in years) and today.year in years, "Calendar does not verify the current local year")
    if mode == "continuous":
        require(cal.get("continuous_24h_verified") is True, "Continuous trading not verified")
        require(cal.get("active_exception") is False, "Continuous venue exception must be resolved or row unavailable")
        return {"state": "open", "timezone": cal["timezone"], "latest": None, "previous": None}
    if mode == "publication":
        require(cal.get("latest_publication_verified") is True, "Treasury latest publication not verified")
        latest, previous = day(cal["latest_published_date"]), day(cal["previous_published_date"])
        require(previous < latest <= today and {previous.year, latest.year} <= set(years), "Invalid Treasury publication sequence/year")
        require((today-latest).days <= 7, "Official observation more than seven days old; investigate before a report")
        return {"state": "official_daily", "timezone": cal["timezone"], "latest": latest, "previous": previous}
    start, end = day(cal["coverage_start"]), day(cal["coverage_end"])
    require(start <= today - timedelta(days=14) and end >= today, "Calendar needs continuous coverage from at least 14 days ago through today")
    require({start.year, end.year, today.year} <= set(years), "Calendar year coverage incomplete")
    require((end-start).days <= 400, "Use a bounded run calendar, not an unbounded schedule")
    supplied = cal.get("days")
    require(isinstance(supplied, list), "Calendar days missing")
    mapped = {}
    for row in supplied:
        d = day(row["date"])
        require(start <= d <= end and d not in mapped, "Duplicate/out-of-coverage calendar day")
        intervals = row.get("intervals")
        require(isinstance(intervals, list), "Every calendar day needs an explicit intervals list")
        require(type(row.get("early_close")) is bool, "Every day needs explicit early_close boolean")
        parsed = []
        for interval in intervals:
            opened, closed = timestamp(interval["open_at"]), timestamp(interval["close_at"])
            require(opened < closed and closed-opened <= timedelta(hours=24), "Invalid session interval")
            require(closed.astimezone(tz).date() == d, "Calendar date means session ending date")
            require(opened.astimezone(tz).date() >= d-timedelta(days=1), "Invalid overnight session start")
            require(not parsed or opened >= parsed[-1][1], "Overlapping/unordered session intervals")
            parsed.append((opened, closed))
        if not parsed:
            require(bool(row.get("closure_reason")), "Nontrading date needs verified closure reason")
        mapped[d] = parsed
    expected = {start+timedelta(days=i) for i in range((end-start).days+1)}
    require(set(mapped) == expected, "Calendar coverage has missing dates; weekends/holidays cannot be guessed")
    all_intervals = sorted((a,b,d) for d, intervals in mapped.items() for a,b in intervals)
    require(all(all_intervals[i][1] <= all_intervals[i+1][0] for i in range(len(all_intervals)-1)), "Calendar sessions overlap")
    active = [(a,b,d) for a,b,d in all_intervals if a <= collected < b]
    breaks = [(intervals[i][1], intervals[i+1][0], d) for d, intervals in mapped.items() for i in range(len(intervals)-1) if intervals[i][1] <= collected < intervals[i+1][0]]
    completed = sorted(d for d, intervals in mapped.items() if intervals and intervals[-1][1] <= collected)
    require(len(completed) >= 2, "Need two independently verified completed sessions; extend calendar/history")
    state = "open" if active else ("break" if breaks else "closed")
    facts = {"state": state, "timezone": cal["timezone"], "latest": completed[-1], "previous": completed[-2]}
    if active:
        facts.update(open_at=active[0][0], close_at=active[0][1], session_date=active[0][2])
    if breaks:
        facts.update(break_start=breaks[0][0], break_end=breaks[0][1], session_date=breaks[0][2])
    return facts


def check_row(row, root, entries, facts, collected, run_id):
    key = row["id"]
    spec = ASSETS[key]
    require(row.get("run_id") == run_id, "Quote row belongs to another run")
    require(row.get("instrument_id") == spec["instrument_id"], "Wrong benchmark/instrument identity")
    require(row.get("calendar_id") == spec["calendar_id"], "Wrong benchmark calendar")
    require(row.get("calendar_verified") is True and row.get("session_timezone") == facts["timezone"], "Quote calendar/timezone unverified")
    require(row.get("market_state") == facts["state"], "Quote state differs from independently derived calendar state")
    current = evidence_ref(root, row, "evidence_", entries)
    require(timestamp(row["fetched_at"]) == timestamp(current["fetched_at"]), "Quote retrieval time must be actual evidence completion bound")
    require(row.get("source_url") in current["source_urls"], "Quote source URL missing from its retained evidence call")
    for name in list(row):
        if name.endswith("_evidence_file"):
            evidence_ref(root, row, name[:-4], entries)
    require(row.get("data_route") in ("ibkr", "public_web"), "Declare actual read-only connector or public-web route")
    if row["data_route"] == "ibkr":
        require("interactive_brokers" in current["tool"].lower() or "ibkr" in current["tool"].lower(), "IBKR data must identify its actually called connector")
        contract = row.get("provider_contract", {})
        if "contract" in spec:
            require([contract.get("contract_id"), contract.get("exchange"), contract.get("security_type")] == spec["contract"], "Resolved provider contract is not this benchmark")
        require(current["args"].get("contract_id") == contract.get("contract_id") and current["args"].get("exchange") == contract.get("exchange"), "Quote evidence query used a different provider contract")
    elif key == "SSE":
        second = evidence_ref(root, row, "corroboration_evidence_", entries)
        corroboration_url = row.get("corroboration_source_url")
        require(corroboration_url in second["source_urls"] and public_url(corroboration_url) != public_url(row["source_url"]), "SSE needs a separately accessed, different-domain corroborating source")
        require(market_module.dec(row["corroboration_previous_value"]) == market_module.dec(row["previous_value"]) and row.get("corroboration_previous_date") == row.get("previous_date"), "SSE corroboration must independently agree on previous completed close/date")
    delay_status = row.get("source_delay_status")
    require(delay_status in ("declared", "not_declared", "declared_unspecified", "official_daily_not_live"), "Explicit delay status required; unknown is not zero")
    if delay_status == "declared":
        delay = row.get("source_delay_seconds")
        require(isinstance(delay, (int, float)) and not isinstance(delay, bool) and 0 <= delay <= 86400, "Declared delay needs finite nonnegative seconds no greater than one day")
        if row.get("quote_kind") == "delayed":
            require(row.get("delay_seconds") == delay, "Conflicting delay fields")
    elif delay_status == "declared_unspecified":
        require(bool(row.get("delay_disclosure")), "Unspecified delay needs provider disclosure")
    elif delay_status == "not_declared":
        require(row.get("source_delay_seconds") is None, "Undeclared delay cannot be represented as known zero")
    if row.get("quote_date_inferred"):
        require(bool(row.get("quote_date_inference")), "Inferred quote date needs retained explanation")
        evidence_ref(root, row, "quote_date_context_evidence_", entries)
    if row.get("quote_kind") in ("regular_close", "official_daily", "session_close"):
        require(day(row["asof_date"]) == facts["latest"] == day(row["expected_session_date"]), "Not the independently expected latest complete/published date")
        require(day(row["previous_date"]) == facts["previous"], "Baseline is not the preceding complete/published date")
        require(row.get("session_complete") is True, "Incomplete daily observation")
        if key in EQUITIES:
            require(facts["state"] == "closed", "Do not substitute a prior close while the regular market is open or at lunch")
        elif key in ("XAUUSD", "BRENT"):
            delayed_reopen = facts["state"] == "open" and delay_status == "declared" and collected-facts["open_at"] <= timedelta(seconds=row["source_delay_seconds"])
            require(facts["state"] == "closed" or delayed_reopen, "Session-close fallback needs verified closure or declared delayed reopening window")
    else:
        quoted = timestamp(row["quote_at"])
        require(facts["state"] in ("open", "break"), "Intraday value needs open or verified lunch session")
        if key != "BTCUSD":
            require(day(row["previous_date"]) == facts["latest"], "Intraday denominator is not latest completed source session")
        if key in EQUITIES and facts["state"] == "open":
            require(facts["open_at"] <= quoted <= collected, "Equity quote is outside current regular interval")
        if facts["state"] == "break":
            require(key in ("SSE", "HSI"), "Unsupported intraday break route")
            require(timestamp(row["break_start_at"]) == facts["break_start"] and timestamp(row["break_end_at"]) == facts["break_end"], "Lunch pause differs from verified calendar")
        if row.get("quote_kind") == "bar_close":
            require(timestamp(row["source_bar_time"]) + timedelta(seconds=60) == quoted, "Minute quote_at must equal bar start plus 60 seconds")
            require(quoted.second == 0 and quoted.microsecond == 0, "Minute interval boundary is not exact")
            require(quoted <= timestamp(row["fetched_at"]), "Incomplete minute bar")
        if key == "BTCUSD":
            require(row.get("quote_kind") == "bar_close" and row.get("source_type") == "AggLast", "Paxos BTC requires completed AggLast one-minute bars")
            require(quoted-timestamp(row["previous_at"]) == timedelta(seconds=86400), "BTC denominator must be exact matching minute 24 hours earlier")
            require(timestamp(row["previous_source_bar_time"])+timedelta(seconds=60) == timestamp(row["previous_at"]), "BTC prior bar boundary invalid")
        if key == "XAUUSD":
            require(row.get("quote_kind") == "bar_close" and row.get("source_type") == "MidPoint", "Gold requires completed indicative MidPoint one-minute bars")
    if key == "BRENT":
        ladder = evidence_ref(root, row, "contract_evidence_", entries)
        baseline = evidence_ref(root, row, "baseline_evidence_", entries)
        expiry_evidence = evidence_ref(root, row, "expiry_evidence_", entries)
        expiry_host = public_url(row.get("expiry_source_url"))
        require(expiry_host == "ice.com" or expiry_host.endswith(".ice.com"), "Brent final-trading cutoff requires official ICE source")
        require(row["expiry_source_url"] in expiry_evidence["source_urls"], "Expiry source missing from retained evidence")
        require(type(row.get("contract_id")) is int and row["contract_id"] > 0, "Fresh resolved Brent contract required")
        require(row.get("baseline_contract_id") == row["contract_id"], "Never compare different Brent delivery contracts")
        require(row.get("contract_confirmed") is True and row.get("front_month_verified") is True, "Earliest unexpired delivery not verified")
        expiry = timestamp(row["contract_last_trade_at"])
        require(collected < expiry and day(row["contract_expiry"]) == expiry.astimezone(ZoneInfo("Europe/London")).date(), "Brent front contract has reached its exchange-defined last trading cutoff")
        require(isinstance(row.get("contract_month"), str) and len(row["contract_month"]) == 6 and row["contract_month"].isdigit(), "Brent delivery month must be YYYYMM")
        day(row["contract_month"][:4] + "-" + row["contract_month"][4:] + "-01")
        if row["data_route"] == "ibkr":
            require(row.get("provider_contract") == {"contract_id": row["contract_id"], "exchange": "IPE", "security_type": "FUT"}, "Wrong Brent provider contract")
            require(baseline["args"].get("contract_id") == row["contract_id"] and baseline["args"].get("exchange") == "IPE", "Brent baseline evidence uses a different contract")
            require(ladder["args"].get("underlying_contract_id") == 30865593, "Brent ladder uses a different underlying")
    if key == "XAUUSD":
        baseline = evidence_ref(root, row, "baseline_evidence_", entries)
        if row["data_route"] == "ibkr":
            require(baseline["args"].get("contract_id") == 69067924 and baseline["args"].get("exchange") == "SMART", "Gold baseline evidence uses a different provider contract")
    if key == "US10Y":
        require(row.get("yield_definition") == "CMT" and row.get("quote_kind") == "official_daily", "Treasury must be official nominal par 10-year CMT, not TNX/live proxy")
        require(public_url(row["source_url"]) in ("home.treasury.gov", "treasury.gov"), "Treasury quote must come from official table")


def validate_run(root, now=None):
    """Return normalized partial/full result, or hard-fail stale/empty/invalid run."""
    root = Path(root).resolve()
    request = read_json(root / "request.json")
    require(isinstance(request, dict), "Request must be an object")
    require(request.get("schema") == VERSION and bool(request.get("run_id")), "Not an initialized quote request")
    require(request.get("freshness_limit_seconds") == MAX_RUN_AGE, "Do not relax the freshness policy")
    require(isinstance(request.get("required_assets"), list) and all(isinstance(a, dict) for a in request["required_assets"]) and [a.get("id") for a in request["required_assets"]] == list(ASSETS), "Request must contain exactly the nine required assets")
    digest = file_hash(root / "request.json")
    snapshot = read_json(root / "quotes.json")
    manifest = read_json(root / "evidence" / "manifest.json")
    calendar = read_json(root / "calendar.json")
    for name, obj in (("Snapshot", snapshot), ("Manifest", manifest), ("Calendar", calendar)):
        require(isinstance(obj, dict), name + " must be an object")
        check_binding(obj, request, digest, name)
    now = now or utc_now()
    started, collected = timestamp(request["run_started_at"]), timestamp(snapshot["collected_at"])
    require(started <= collected <= now + timedelta(seconds=CLOCK_SKEW), "Run times are unordered or future-dated")
    require(now-started <= timedelta(seconds=MAX_RUN_AGE) and now-collected <= timedelta(seconds=MAX_RUN_AGE), "Stale snapshot/run: initialize a new run and fetch again")
    require(timestamp(calendar["evaluated_at"]) == collected, "Calendar must be evaluated at actual collection cutoff")
    entries = check_manifest(root, manifest, started, collected)
    rows = snapshot.get("quotes")
    require(isinstance(rows, list) and len(rows) == 9 and all(isinstance(r, dict) for r in rows) and {r.get("id") for r in rows} == set(ASSETS), "Snapshot must contain exactly one row per required asset")
    calendars = calendar.get("calendars")
    require(isinstance(calendars, list) and all(isinstance(c, dict) for c in calendars), "Calendar list missing or malformed")
    require(len({c.get("calendar_id") for c in calendars}) == len(calendars), "Duplicate calendar ID")
    by_calendar = {c.get("calendar_id"): c for c in calendars}
    valid_rows, errors, fact_cache = [], {}, {}
    for raw in rows:
        row = dict(raw)
        key = row["id"]
        try:
            require(row.get("run_id") == request["run_id"], "Quote row lacks current run binding")
            require(row.get("status") in ("verified", "unavailable"), "Pending row must be collected or explicitly marked unavailable")
            if row["status"] == "unavailable":
                require(bool(row.get("reason")), "Unavailable row needs actionable reason")
                require(not any(row.get(n) is not None for n in ("value", "previous_value", "quote_at", "asof_date")), "Unavailable row must not retain stale values")
            else:
                cid = ASSETS[key]["calendar_id"]
                require(cid in by_calendar, "Missing independently verified run calendar")
                if cid not in fact_cache:
                    fact_cache[cid] = calendar_facts(by_calendar[cid], root, entries, collected)
                check_row(row, root, entries, fact_cache[cid], collected, request["run_id"])
        except (ContractError, KeyError, ValueError, OSError, TypeError, InvalidOperation) as exc:
            errors[key] = str(exc)
            row = {"id": key, "status": "unavailable", "reason": str(exc)}
        valid_rows.append(row)
    normalized = market_module.normalize({"collected_at": snapshot["collected_at"], "quotes": valid_rows}, root)
    for row in normalized["quotes"]:
        if row["status"] == "unavailable":
            errors[row["id"]] = row["reason"]
    require(normalized["verified_count"] > 0, "All nine quotes unavailable: market-data step failed. " + json.dumps(errors, ensure_ascii=False))
    normalized.update(run_id=request["run_id"], request_sha256=digest, validation_errors=errors)
    return normalized


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("init", help="Create fresh current-UTC request and empty pending quote rows")
    p.add_argument("--run-dir", required=True, type=Path)
    p = sub.add_parser("validate", help="Validate current-run evidence/calendar and write normalized rows")
    p.add_argument("--run-dir", required=True, type=Path)
    p.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            req = init_run(args.run_dir)
            print(json.dumps({"status": "pending_collection", "run_id": req["run_id"], "run_started_at": req["run_started_at"], "assets": len(ASSETS)}, ensure_ascii=False))
        else:
            result = validate_run(args.run_dir)
            output = args.output or args.run_dir / "market.normalized.json"
            write_json(output, result)
            print(json.dumps({"status": result["status"], "verified_count": result["verified_count"], "validation_errors": result["validation_errors"]}, ensure_ascii=False))
        return 0
    except (ContractError, KeyError, TypeError, OSError, ValueError) as exc:
        print(json.dumps({"status": "market_data_error", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
