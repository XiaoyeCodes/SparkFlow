"""Read official regional yearbook tables. Never fill missing cells by inference.

Runtime dependencies: pip install -r scripts/requirements-china-regional.txt
Outputs one JSON document to stdout; diagnostics are part of the result.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import html
import io
import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
NOW = dt.datetime.now(dt.timezone.utc)
YEAR = NOW.year


def compact(value):
    if value is None or pd.isna(value):
        return ""
    return re.sub(r"[\s\u3000]+", "", html.unescape(str(value)))


def official_url(url):
    p = urlparse(url)
    return p.scheme in ("http", "https") and p.hostname and p.hostname.endswith(".gov.cn")


def fetch(url):
    if not official_url(url):
        raise ValueError("非官方网址")
    session = requests.Session()
    session.trust_env = False
    response = session.get(url, timeout=(8, 15), headers={"User-Agent": "Mozilla/5.0"}, allow_redirects=False, stream=True)
    for _ in range(3):
        if response.is_redirect:
            url = urljoin(url, response.headers["Location"])
            if not official_url(url):
                raise ValueError("非官方重定向")
            response.close()
            response = session.get(url, timeout=(8, 15), allow_redirects=False, stream=True)
    response.raise_for_status()
    body = bytearray()
    try:
        for chunk in response.iter_content(65536):
            body.extend(chunk)
            if len(body) > 20_000_000:
                raise ValueError("文件过大")
        return bytes(body)
    finally:
        response.close()
        session.close()


def decode(body):
    charset = re.search(rb'charset\s*=\s*["\']?([\w-]+)', body[:12000], re.I)
    for encoding in ([charset[1].decode()] if charset else []) + ["utf-8", "gb18030"]:
        try:
            return body.decode(encoding)
        except (UnicodeError, LookupError):
            pass
    raise ValueError("网页编码无法识别")


def links(text, base):
    found = []
    for href, label in re.findall(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>', text, re.I):
        url = urljoin(base, html.unescape(href))
        if official_url(url):
            found.append((url, compact(re.sub(r"<[^>]+>", "", label))))
    for href in re.findall(r'<(?:i?frame)\b[^>]*src=["\']([^"\']+)', text, re.I):
        url = urljoin(base, href)
        if official_url(url) and not re.search(r"/(?:top|title|main)\.htm", url, re.I):
            found.append((url, "年鉴目录"))
    return found


def metric_of(text):
    t = compact(text)
    if any(word in t for word in ["增长", "指数", "比重", "构成", "增速", "美元", "不变价", "可比价"]):
        return None
    if re.search(r"人均(?:地区)?(?:生产总值|GDP)", t, re.I):
        return "perCapita"
    if re.search(r"(?:地区)?生产总值|GrossDomesticProduct", t, re.I) and "人均" not in t:
        return "gdp"
    if "常住人口" in t and not any(w in t for w in ["城镇", "乡村", "出生", "死亡", "比重"]):
        return "population"
    return None


def multiplier(metric, text):
    t = compact(text)
    if metric == "gdp":
        return 10000 if "万亿元" in t else 1 if "亿元" in t else .0001 if "万元" in t else None
    if metric == "population":
        return .01 if "万人" in t else .000001 if "人" in t else None
    if metric == "perCapita":
        return 10000 if "万元" in t else 1 if "元" in t else None


def parse_table(frame, title, url, scope, registry):
    """Support year-by-column and indicator-by-column official tables.

    Only exact region names within a province are accepted. Ambiguous district
    names need a preceding city row. No fuzzy name matching across boundaries.
    """
    rows = [[compact(v) for v in row] for row in frame.itertuples(index=False, name=None)]
    by_name = {}
    for code, r in registry.items():
        if code.startswith(scope):
            by_name.setdefault(compact(r["name"]), []).append(code)
    header_end = next((i for i, row in enumerate(rows) if any(cell in by_name for cell in row)), None)
    if header_end is None:
        return []
    headers = rows[:header_end]
    header_text = title + " " + " ".join(" ".join(r) for r in headers)
    # Printed yearbooks often arrange several independent region/value blocks
    # side by side. Parse each block separately rather than treating a second
    # region's value as another metric of the first region.
    name_columns = [col for col in range(len(rows[0])) if
                    sum(row[col] in by_name for row in rows[header_end:]) >= 3]
    if len(name_columns) > 1:
        result = []
        shared_units = " ".join(cell for row in headers for cell in row if '单位' in cell
                                or re.fullmatch(r'[（(]?(?:万人|亿元|万元|元)[）)]?', cell))
        for index, start in enumerate(name_columns):
            end = name_columns[index + 1] if index + 1 < len(name_columns) else len(rows[0])
            result.extend(parse_table(frame.iloc[:, start:end], title + ' ' + shared_units, url, scope, registry))
        return result
    years = [int(x) for x in re.findall(r"(?<!\d)(20\d{2})(?!\d)", header_text) if 2000 <= int(x) < YEAR]
    if not years:
        return []
    period = max(years)
    title_metric = metric_of(title) or metric_of(" ".join(rows[0]))
    columns = []
    # Propagate explicit merged indicator headings only up to the next heading.
    for col in range(1, len(rows[0])):
        parts = [r[col] for r in headers if col < len(r) and r[col]
                 and not (len([x for x in r if x]) > 1 and len(set(x for x in r if x)) == 1)]
        context = " ".join(parts)
        direct = metric_of(context)
        col_years = [int(v[:4]) for v in parts if re.fullmatch(r"20\d{2}(?:\.0)?年?", v)]
        if any(re.search(r"%|％|指数|增长|比重|构成|上年", v) for v in parts):
            continue
        metric = direct
        if not metric and col_years:
            for row in reversed(headers):
                for prev in range(col, 0, -1):
                    if row[prev] and not re.fullmatch(r"[\d.]+年?", row[prev]):
                        metric = metric_of(row[prev])
                        break
                if metric:
                    break
            metric = metric or title_metric
        # Single-metric tables without year columns may contain several numeric
        # columns; do not guess which one is the total.
        if not metric:
            continue
        year = max(col_years) if col_years else period
        if year != period:
            continue
        factor = multiplier(metric, context)
        if factor is None:
            units = " ".join(cell for r in headers for cell in r if "单位" in cell)
            factor = multiplier(metric, units)
        if factor is None:
            continue
        columns.append((col, metric, factor, year))
    # Multiple columns for one metric are ambiguous unless only one is latest.
    columns = [c for c in columns if sum(x[1] == c[1] for x in columns) == 1]
    result = []
    city = None
    for row in rows[header_end:]:
        names = [(i, by_name[cell]) for i, cell in enumerate(row[:2]) if cell in by_name]
        if len(names) != 1:
            continue
        name_col, candidates = names[0]
        if len(candidates) > 1:
            candidates = [c for c in candidates if registry[c].get("parentCityCode") == city]
        if len(candidates) != 1:
            continue
        code = candidates[0]
        if registry[code]["level"] == "city":
            city = code
        for col, metric, factor, year in columns:
            if col <= name_col or col >= len(row):
                continue
            raw = row[col].replace(",", "")
            if not re.fullmatch(r"\d+(?:\.\d+)?", raw):
                continue
            value = round(float(raw) * factor, 6)
            maximum = {"gdp": 100000, "population": 100, "perCapita": 5000000}[metric]
            if not 0 < value < maximum:
                continue
            result.append({"adcode": code, "metric": metric, "value": value, "period": str(year),
                           "sourceUrl": url, "source": "地方统计局官方年鉴", "checkedAt": NOW.isoformat(),
                           "editionYear": max([int(y) for y in re.findall(r'(?<!\d)(20\d{2})(?!\d)', url) if int(y) <= YEAR] or [year]),
                           "basis": "year-end-resident" if metric == "population" else "official",
                           "evidence": f"{title} | {row[name_col]} | {raw}"})
    return result


def collect(source, registry):
    scope = source["scope"]
    observations, errors, documents = [], [], []
    queue = [(u, 0) for u in source["catalogs"]]
    visited, tables = set(), {}
    while queue and len(visited) < 9:
        url, depth = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)
        try:
            text = decode(fetch(url))
            page_links = links(text, url)
            if not page_links:
                raise ValueError("栏目未返回可读取目录")
            for link, label in page_links:
                is_metric = bool(re.search(r"人口|生产总值|主要经济指标", label))
                if is_metric and not re.search(r"^图|增长|指数|构成|出生|死亡|迁移|年龄|城乡|城镇人口", label):
                    # Shanghai's index uses a viewer URL whose d1 parameter is
                    # the actual HTML table. Resolve it only within this host.
                    if "?d1=" in link:
                        target = link.split("?d1=", 1)[1].split("&", 1)[0]
                        link = urljoin(link, target)
                    if re.search(r"\.(?:xls[x]?|htm[l]?)($|\?)", link, re.I):
                        tables[link] = label
                    elif re.search(r"\.(?:jpg|png|pdf)($|\?)", link, re.I):
                        errors.append({"url": link, "reason": "图片/PDF统计表待核对", "title": label})
                        # Several official yearbooks publish both a rendered
                        # image and its same-name Excel original. Only accept
                        # the companion after successfully reading its table.
                        if re.search(r'各区|各县|各市|分区|分县', label) and re.search(r'\.(jpg|png)$', link, re.I):
                            tables[re.sub(r'\.(jpg|png)$', '.xls', link, flags=re.I)] = label
                if depth < 3 and (re.search(r"(?:left|indexc[he]|lefte)\.htm", link, re.I)
                                  or re.search(r"年鉴目录|统计年鉴|统计数据", label)):
                    if re.search(r"\.(?:zip|rar|exe|pdf)($|\?)", link, re.I):
                        errors.append({"url": link, "reason": "打包或 PDF 年鉴待接入", "title": label})
                    else:
                        queue.append((link, depth + 1))
            queue.sort(key=lambda x: max(re.findall(r"20\d{2}", x[0]) or ["0"]), reverse=True)
        except Exception as exc:
            errors.append({"url": url, "reason": str(exc)[:160]})
    def read_table(item):
        url, title = item
        body = fetch(url)
        if re.search(r"\.xlsx?($|\?)", url, re.I):
            frames = pd.read_excel(io.BytesIO(body), sheet_name=None, header=None).values()
        else:
            frames = pd.read_html(io.StringIO(decode(body)), header=None, flavor='lxml')
        found = [v for frame in frames for v in parse_table(frame, title, url, scope, registry)]
        return found, {"url": url, "title": title, "sha256": hashlib.sha256(body).hexdigest(), "observations": len(found)}
    # Each province is low frequency; at most two concurrent official requests.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        ordered = sorted(tables.items(), key=lambda item: (
            -int(bool(re.search(r'各区|各县|分县|分区|各市|分市', item[1]))), item[1]))
        futures = {pool.submit(read_table, item): item for item in ordered[:18]}
        for future in concurrent.futures.as_completed(futures):
            url, title = futures[future]
            try:
                found, document = future.result()
                observations.extend(found)
                documents.append(document)
                if found:
                    errors[:] = [e for e in errors if not (e.get('reason') == '图片/PDF统计表待核对'
                        and e.get('url', '').rsplit('.', 1)[0] == url.rsplit('.', 1)[0])]
                if not found:
                    errors.append({"url": url, "title": title, "reason": "表格口径或行政区域无法明确匹配"})
            except Exception as exc:
                errors.append({"url": url, "title": title, "reason": str(exc)[:160]})
    reviewed = ROOT / 'src/data/chinaRegionalReviewed.json'
    if reviewed.exists():
        data = json.loads(reviewed.read_text(encoding='utf-8'))
        for document in data['documents']:
            matching = [o for o in data['observations'] if o['adcode'].startswith(scope) and o['sourceUrl'] == document['sourceUrl']]
            if not matching:
                continue
            try:
                body = fetch(document['sourceUrl'])
                if hashlib.sha256(body).hexdigest() != document['sha256']:
                    raise ValueError('官方图片已修订，等待重新核对；保留原核对值')
                observations.extend({**o, 'checkedAt': NOW.isoformat()} for o in matching)
            except Exception as exc:
                errors.append({'url': document['sourceUrl'], 'reason': str(exc)[:160]})
    if not observations and not errors:
        errors.append({'reason': '未发现可解析的官方区域统计表，不能据此认定官方未公布'})
    return {"scope": scope, "name": source["name"], "checkedAt": NOW.isoformat(),
            "status": "updated" if observations else "unavailable", "observations": observations,
            "documents": documents, "errors": errors}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", required=True)
    args = parser.parse_args()
    sources = json.loads((ROOT / "src/data/chinaRegionalSources.json").read_text(encoding="utf-8"))
    source = next(s for s in sources if s["scope"] == args.scope)
    registry = json.loads((ROOT / "src/data/chinaRegionalEconomy.json").read_text(encoding="utf-8"))["records"]
    print(json.dumps(collect(source, registry), ensure_ascii=True, allow_nan=False))


if __name__ == "__main__":
    main()
