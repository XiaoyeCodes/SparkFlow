"""Build the nationwide city/county regional snapshot used by the China atlas.

Sources:
- CityEdu-Eco panel.csv (China City Statistical Yearbook 2001-2023; 2000-2022)
- China County Statistical Yearbook 2024, county/city volume (2023 observations)
- China Census county/prefecture panel (2020 population census)
- province-city-china administrative division codes

Every administrative code receives its own profile. Economic and population values
are merged only when the source contains that exact code. Missing cells stay null
and are never inherited from a parent province or filled with a template value.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
from pathlib import Path

import pandas as pd


ADMIN_SOURCE = "民政部2024年县以上行政区划代码"
ADMIN_SOURCE_URL = "https://www.mca.gov.cn/mzsj/xzqh/2023/202401data.html"
CENSUS_SOURCE = "第七次全国人口普查（地方公报汇编）"
CENSUS_SOURCE_URL = "https://github.com/leiii/census"
ECONOMIC_FIELDS = (
    "gdp100mCny", "primary100mCny", "secondary100mCny", "tertiary100mCny",
    "secondaryPercent", "tertiaryPercent", "fiscalRevenue100mCny",
    "fiscalExpenditure100mCny", "deposit100mCny", "loan100mCny",
    "averageWageCny", "areaKm2", "industrialEnterpriseCount",
    "primarySchoolCount", "higherSchoolCount", "healthBedCount",
)


def has_economic_data(record: dict) -> bool:
    return any(record.get(field) is not None for field in ECONOMIC_FIELDS)


def clean_number(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else round(number, 4)


def normalize_name(value: str) -> str:
    name = re.sub(r"[\s*＊]+", "", str(value or ""))
    return re.sub(r"(特别行政区|自治州|地区|盟|市|县)$", "", name)


def latest_city_rows(panel_path: Path):
    panel = pd.read_csv(panel_path)
    panel = panel.sort_values(["city_key", "year"]).groupby("city_key", as_index=False).tail(1)
    return panel.to_dict("records")


def build_city_records(panel_path: Path, city_codes_path: Path):
    city_codes = json.loads(city_codes_path.read_text(encoding="utf-8"))
    by_name: dict[str, list[dict]] = {}
    for entry in city_codes:
        by_name.setdefault(normalize_name(entry["name"]), []).append(entry)

    records = {}
    unmatched = []
    for row in latest_city_rows(panel_path):
        name = str(row["city_key"]).strip()
        candidates = by_name.get(normalize_name(name), [])
        if len(candidates) != 1:
            unmatched.append(name)
            continue
        code = candidates[0]["code"]
        records[code] = {
            "adcode": code,
            "name": candidates[0]["name"],
            "level": "city",
            "period": str(int(row["year"])),
            "source": "中国城市统计年鉴（CityEdu-Eco 整理）",
            "sourceUrl": "https://github.com/Cause-114/CityEdu-Eco/blob/main/data/DATA_NOTES.md",
            "gdp100mCny": clean_number(row.get("gdp")),
            "populationMillion": clean_number(row.get("population")),
            "secondaryPercent": clean_number(row.get("secondary_pct")),
            "tertiaryPercent": clean_number(row.get("tertiary_pct")),
            "fiscalRevenue100mCny": clean_number(row.get("fiscal_revenue")),
            "loan100mCny": clean_number(row.get("loan")),
            "averageWageCny": clean_number(row.get("wage")),
            "primaryTeacherPer10k": clean_number(row.get("primary_teacher_per_10k")),
            "higherTeacherPer10k": clean_number(row.get("higher_teacher_per_10k")),
            "primaryStudentPer10k": clean_number(row.get("primary_student_per_10k")),
            "higherStudentPer10k": clean_number(row.get("higher_student_per_10k")),
            "primarySchoolCount": clean_number(row.get("primary_school_count")),
            "higherSchoolCount": clean_number(row.get("higher_school_count")),
        }
    return records, unmatched


def county_sheet_rows(workbook_path: Path):
    sheet = pd.read_excel(workbook_path, sheet_name=0, header=None)
    names = sheet.iloc[2, 2:].tolist()
    fields = {
        "areaKm2": 4,
        "townCount": 6,
        "streetCount": 7,
        "householdPopulation10k": 8,
        "gdp100mCny": 10,
        "primary100mCny": 11,
        "secondary100mCny": 12,
        "tertiary100mCny": 13,
        "fiscalRevenue100mCny": 14,
        "fiscalExpenditure100mCny": 15,
        "deposit100mCny": 16,
        "loan100mCny": 17,
        "facilityAgricultureHectare": 19,
        "oilCropTonne": 20,
        "cottonTonne": 21,
        "industrialEnterpriseCount": 22,
        "fixedPhoneHousehold": 23,
        "secondaryStudentCount": 25,
        "primaryStudentCount": 26,
        "healthBedCount": 27,
        "civilServiceInstitutionCount": 28,
        "civilServiceBedCount": 29,
    }
    rows = []
    for offset, raw_name in enumerate(names, start=2):
        if pd.isna(raw_name):
            continue
        row = {"name": re.sub(r"[\s*＊]+", "", str(raw_name))}
        for key, index in fields.items():
            value = clean_number(sheet.iloc[index, offset])
            if value is not None and key.endswith("100mCny"):
                value = round(value / 10_000, 4)
            row[key] = value
        rows.append(row)
    return rows


def build_county_records(workbook_path: Path, area_codes_path: Path):
    areas = json.loads(area_codes_path.read_text(encoding="utf-8"))
    rows = county_sheet_rows(workbook_path)
    by_exact: dict[str, list[tuple[int, dict]]] = {}
    by_normalized: dict[str, list[tuple[int, dict]]] = {}
    for index, entry in enumerate(areas):
        exact = re.sub(r"[\s*＊]+", "", entry["name"])
        by_exact.setdefault(exact, []).append((index, entry))
        by_normalized.setdefault(normalize_name(exact), []).append((index, entry))
    records = {}
    unmatched = []
    cursor = 0
    used_codes: set[str] = set()
    for row in rows:
        exact = re.sub(r"[\s*＊]+", "", row["name"])
        candidates = by_exact.get(exact) or by_normalized.get(normalize_name(exact), [])
        candidates = [(index, entry) for index, entry in candidates if entry["code"] not in used_codes]
        if not candidates:
            # A small number of yearbook labels differ from the current code list.
            # Do not guess: leave those rows out and report them to the generator.
            unmatched.append(row["name"])
            continue
        after_cursor = [(index, entry) for index, entry in candidates if index >= cursor]
        match_index, entry = (after_cursor or candidates)[0]
        cursor = max(cursor, match_index + 1)
        code = entry["code"]
        used_codes.add(code)
        records[code] = {
            "adcode": code,
            "name": entry["name"],
            "level": "county",
            "period": "2023",
            "source": "中国县域统计年鉴2024（县市卷）",
            "sourceUrl": "https://github.com/data889/dataset",
            **{key: value for key, value in row.items() if key != "name"},
        }
    return records, unmatched


def seed_nationwide_profiles(records: dict, city_codes_path: Path, area_codes_path: Path):
    """Create a distinct profile for every city and county administrative code."""
    city_codes = json.loads(city_codes_path.read_text(encoding="utf-8"))
    area_codes = json.loads(area_codes_path.read_text(encoding="utf-8"))
    seeded = {}
    for entry in city_codes:
        code = str(entry["code"])
        seeded[code] = {
            "adcode": code,
            "name": entry["name"],
            "level": "city",
            "parentProvinceCode": f'{entry["province"]}0000',
            "period": "2024",
            "source": ADMIN_SOURCE,
            "sourceUrl": ADMIN_SOURCE_URL,
            "dataCoverage": "administrative",
        }
    for entry in area_codes:
        code = str(entry["code"])
        seeded[code] = {
            "adcode": code,
            "name": entry["name"],
            "level": "county",
            "parentProvinceCode": f'{entry["province"]}0000',
            "parentCityCode": f'{entry["province"]}{entry["city"]}00',
            "period": "2024",
            "source": ADMIN_SOURCE,
            "sourceUrl": ADMIN_SOURCE_URL,
            "dataCoverage": "administrative",
        }
    for code, record in records.items():
        if code not in seeded:
            seeded[code] = record
            continue
        seeded[code].update(record)
        if has_economic_data(record):
            seeded[code]["economicPeriod"] = record.get("economicPeriod") or record.get("period")
            seeded[code]["economicSource"] = record.get("economicSource") or record.get("source")
            seeded[code]["economicSourceUrl"] = record.get("economicSourceUrl") or record.get("sourceUrl")
            seeded[code]["dataCoverage"] = "economic"
        elif record.get("censusPopulationMillion") is not None:
            seeded[code]["period"] = "2024"
            seeded[code]["source"] = ADMIN_SOURCE
            seeded[code]["sourceUrl"] = ADMIN_SOURCE_URL
            seeded[code].pop("economicPeriod", None)
            seeded[code].pop("economicSource", None)
            seeded[code].pop("economicSourceUrl", None)
            seeded[code]["populationMillion"] = record["censusPopulationMillion"]
            seeded[code]["populationPeriod"] = "2020"
            seeded[code]["populationSource"] = CENSUS_SOURCE
            seeded[code]["populationSourceUrl"] = CENSUS_SOURCE_URL
            seeded[code]["dataCoverage"] = "population"
        else:
            seeded[code]["period"] = "2024"
            seeded[code]["source"] = ADMIN_SOURCE
            seeded[code]["sourceUrl"] = ADMIN_SOURCE_URL
            seeded[code].pop("economicPeriod", None)
            seeded[code].pop("economicSource", None)
            seeded[code].pop("economicSourceUrl", None)
            seeded[code]["dataCoverage"] = "administrative"
    return seeded


def merge_census_population(records: dict, census_path: Path, level: str):
    if not census_path or not census_path.exists():
        return 0
    frame = pd.read_csv(census_path, dtype=str)
    code_column = "city_code" if level == "city" else "county_code"
    merged = 0
    for row in frame.to_dict("records"):
        code = str(row.get(code_column) or "").strip()
        if not re.fullmatch(r"\d{6}", code) or code not in records:
            continue
        population = clean_number(row.get("popu_2020"))
        if population is None:
            continue
        record = records[code]
        record["censusPopulationMillion"] = round(population / 1_000_000, 6)
        record["censusPeriod"] = "2020"
        record["censusSource"] = CENSUS_SOURCE
        record["censusSourceUrl"] = CENSUS_SOURCE_URL
        if not has_economic_data(record) or (record.get("populationMillion") is None and record.get("householdPopulation10k") is None):
            record["populationMillion"] = record["censusPopulationMillion"]
            record["populationPeriod"] = "2020"
            record["populationSource"] = CENSUS_SOURCE
            record["populationSourceUrl"] = CENSUS_SOURCE_URL
        else:
            record["populationPeriod"] = record.get("economicPeriod") or record.get("period")
            record["populationSource"] = record.get("economicSource") or record.get("source")
            record["populationSourceUrl"] = record.get("economicSourceUrl") or record.get("sourceUrl")
        record["sexRatio"] = clean_number(row.get("male_female_2020"))
        record["age0To14Percent"] = clean_number(row.get("age_0_14_2020"))
        record["age60PlusPercent"] = clean_number(row.get("age_60_2020"))
        record["age65PlusPercent"] = clean_number(row.get("age_65_2020"))
        record["householdSize"] = clean_number(row.get("household_2020"))
        if record.get("dataCoverage") == "administrative":
            record["dataCoverage"] = "population"
        merged += 1
    return merged


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--city-panel", type=Path)
    parser.add_argument("--county-workbook", type=Path)
    parser.add_argument("--city-codes", default=Path(os.environ["TEMP"]) / "china-city-codes.json", type=Path)
    parser.add_argument("--area-codes", default=Path(os.environ["TEMP"]) / "china-area-codes.json", type=Path)
    parser.add_argument("--census-city", type=Path)
    parser.add_argument("--census-county", type=Path)
    parser.add_argument("--base", type=Path, help="Existing source-backed JSON to extend when raw yearbooks are omitted")
    parser.add_argument("--output", default=Path("src/data/chinaRegionalEconomy.json"), type=Path)
    args = parser.parse_args()

    if args.city_panel and args.county_workbook:
        city_records, city_unmatched = build_city_records(args.city_panel, args.city_codes)
        county_records, county_unmatched = build_county_records(args.county_workbook, args.area_codes)
        source_records = {**city_records, **county_records}
    else:
        base_path = args.base or args.output
        if not base_path.exists():
            parser.error("--city-panel/--county-workbook or an existing --base JSON is required")
        base = json.loads(base_path.read_text(encoding="utf-8"))
        source_records = base.get("records", {})
        city_records = {code: item for code, item in source_records.items() if item.get("level") == "city" and has_economic_data(item)}
        county_records = {code: item for code, item in source_records.items() if item.get("level") == "county" and has_economic_data(item)}
        city_unmatched = []
        county_unmatched = []
    records = seed_nationwide_profiles(source_records, args.city_codes, args.area_codes)
    census_city_count = merge_census_population(records, args.census_city, "city")
    census_county_count = merge_census_population(records, args.census_county, "county")
    output = {
        "metadata": {
            "administrativePeriod": "2024",
            "administrativeCoverage": "all city/county codes in the bundled Ministry of Civil Affairs list",
            "cityPeriod": "latest row per city, through 2022",
            "countyPeriod": "2023",
            "populationPeriod": "2020 census; newer yearbook population is retained where available",
            "citySource": "https://github.com/Cause-114/CityEdu-Eco/blob/main/data/DATA_NOTES.md",
            "countySource": "https://github.com/data889/dataset",
            "populationSource": CENSUS_SOURCE_URL,
            "administrativeCodeSource": "https://github.com/FlywardAero/province-city-china-202411",
        },
        "records": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    city_total = sum(1 for item in records.values() if item.get("level") == "city")
    county_total = sum(1 for item in records.values() if item.get("level") == "county")
    print(f"city={city_total} county={county_total} total={len(output['records'])}")
    print(f"economic city={len(city_records)} county={len(county_records)}")
    print(f"census city={census_city_count} county={census_county_count}")
    print(f"unmatched city={len(city_unmatched)} county={len(county_unmatched)}")
    if city_unmatched:
        print("city sample:", city_unmatched[:10])
    if county_unmatched:
        print("county sample:", county_unmatched[:20])


if __name__ == "__main__":
    main()
