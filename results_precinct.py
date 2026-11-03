#!/usr/bin/env python3
"""Precinct-level results, one spreadsheet per county, from the Clarity ENR export.

Each Clarity ENR site publishes a "Candidate Results by Precinct and Party (CSV)"
under {base}/{key}/{id}/Reports/. That single file contains every contest in the
county, every precinct, split by mail / early / election day.

For each county this script:
  * re-reads the Reports page (the export URL carries a timestamp + uuid, so it
    changes on every county update)
  * downloads the CSV
  * stores it gzipped under <snapshot>/raw/
  * writes <snapshot>/precincts/<County>.xlsx with Summary, By Precinct, By Contest
    and the full long-format Data sheet

Usage: results_precinct.py <snapshot_dir>
Env:   PRECINCT_XLSX=0   skip the spreadsheets, keep only the gzipped CSVs
"""
import csv, gzip, io, json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import xlsxwriter
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "raw", "enr_ids.json")
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}

NAMES = {"ALA": "Alachua", "BAK": "Baker", "BAY": "Bay", "BRA": "Bradford", "BRE": "Brevard",
         "BRO": "Broward", "CAL": "Calhoun", "CHA": "Charlotte", "CIT": "Citrus", "CLA": "Clay",
         "CLL": "Collier", "CLM": "Columbia", "DES": "DeSoto", "DIX": "Dixie", "DUV": "Duval",
         "ESC": "Escambia", "FLA": "Flagler", "FRA": "Franklin", "GAD": "Gadsden",
         "GIL": "Gilchrist", "GLA": "Glades", "GUL": "Gulf", "HAM": "Hamilton",
         "HAR": "Hardee", "HEN": "Hendry", "HER": "Hernando", "HIG": "Highlands",
         "HIL": "Hillsborough", "HOL": "Holmes", "IND": "Indian River", "JAC": "Jackson",
         "JEF": "Jefferson", "LAF": "Lafayette", "LAK": "Lake", "LEE": "Lee", "LEO": "Leon",
         "LEV": "Levy", "LIB": "Liberty", "MAD": "Madison", "MAN": "Manatee", "MRN": "Marion",
         "MRT": "Martin", "DAD": "Miami-Dade", "MON": "Monroe", "NAS": "Nassau",
         "OKA": "Okaloosa", "OKE": "Okeechobee", "ORA": "Orange", "OSC": "Osceola",
         "PAL": "Palm Beach", "PAS": "Pasco", "PIN": "Pinellas", "POL": "Polk", "PUT": "Putnam",
         "SAN": "Santa Rosa", "SAR": "Sarasota", "SEM": "Seminole", "STJ": "St. Johns",
         "STL": "St. Lucie", "SUM": "Sumter", "SUW": "Suwannee", "TAY": "Taylor",
         "UNI": "Union", "VOL": "Volusia", "WAK": "Wakulla", "WAL": "Walton",
         "WAS": "Washington"}


def num(v):
    v = (v or "").replace(",", "").replace("%", "").strip()
    if v in ("", "-", "--"):
        return 0
    try:
        return float(v) if "." in v else int(v)
    except ValueError:
        return 0


def fetch(code, cfg, raw_dir, timeout=120):
    base = cfg.get("base", "https://enr.electionsfl.org").rstrip("/")
    key = cfg.get("key", code)
    eid = cfg["id"]
    reports = f"{base}/{key}/{eid}/Reports/"
    out = {"code": code, "county": NAMES.get(code, code), "reports_url": reports,
           "csv_url": None, "rows": [], "error": None}
    try:
        r = requests.get(reports, headers=H, timeout=40)
        if r.status_code != 200:
            out["error"] = f"reports HTTP {r.status_code}"
            return out
        if "11/3/2026" not in r.text and "11/03/2026" not in r.text:
            out["error"] = "wrong election (not 11/3/2026)"
            return out
        m = re.search(r'href="([^"]*CandidateResultsbyPrecinctandParty[^"]*\.csv)"', r.text)
        if not m:
            out["error"] = "no precinct CSV link"
            return out
        csv_url = requests.compat.urljoin(reports, m.group(1))
        out["csv_url"] = csv_url
        c = requests.get(csv_url, headers=H, timeout=timeout)
        if c.status_code != 200 or len(c.content) < 200:
            out["error"] = f"csv HTTP {c.status_code}"
            return out
        blob = c.content
        with gzip.open(os.path.join(raw_dir, f"precinct_{code}.csv.gz"), "wb") as f:
            f.write(blob)
        text = blob.decode("utf-8-sig", errors="replace")
        for row in csv.DictReader(io.StringIO(text)):
            out["rows"].append({
                "contest": (row.get("Contest") or "").strip(),
                "candidate": (row.get("Candidate Issue") or "").strip(),
                "party": (row.get("Party") or "").strip(),
                "precinct": (row.get("Precinct Name") or "").strip(),
                "mail": num(row.get("Mail Votes")),
                "early": num(row.get("Early Votes")),
                "election_day": num(row.get("Election Day Votes")),
                "total": num(row.get("Total Votes")),
                "pct": num(row.get("% of Total Votes")),
            })
    except Exception as e:
        out["error"] = str(e)[:80]
    return out


def write_workbook(path, res, pulled_at):
    rows = res["rows"]
    wb = xlsxwriter.Workbook(path, {"nan_inf_to_errors": True})
    F = {
        "title": wb.add_format({"bold": True, "font_size": 15, "font_color": "#0B3D63"}),
        "sub": wb.add_format({"italic": True, "font_size": 9, "font_color": "#666666"}),
        "h": wb.add_format({"bold": True, "bg_color": "#0B3D63", "font_color": "white", "border": 1, "text_wrap": True}),
        "int": wb.add_format({"num_format": "#,##0"}),
        "pct": wb.add_format({"num_format": "0.00"}),
        "txt": wb.add_format({"valign": "top"}),
    }

    ws = wb.add_worksheet("Summary")
    ws.set_column(0, 0, 30); ws.set_column(1, 1, 80)
    ws.write(0, 0, f'{res["county"]} County — precinct-level results', F["title"])
    ws.write(1, 0, "Unofficial. Mail / early / election day split per precinct and candidate.", F["sub"])
    contests = sorted({r["contest"] for r in rows})
    precincts = sorted({r["precinct"] for r in rows})
    meta = [
        ("County", res["county"]),
        ("Source", res.get("csv_url") or res.get("reports_url")),
        ("Pulled at", pulled_at),
        ("Contests", len(contests)),
        ("Precincts", len(precincts)),
        ("Candidate rows", len(rows)),
        ("Total votes", sum(r["total"] for r in rows)),
        ("Mail", sum(r["mail"] for r in rows)),
        ("Early", sum(r["early"] for r in rows)),
        ("Election day", sum(r["election_day"] for r in rows)),
    ]
    for i, (k, v) in enumerate(meta, start=3):
        ws.write(i, 0, k, F["h"]); ws.write(i, 1, v)

    # pivot: precinct x total
    ws2 = wb.add_worksheet("By Precinct")
    ws2.write(0, 0, "Precinct", F["h"]); ws2.write(0, 1, "Mail", F["h"])
    ws2.write(0, 2, "Early", F["h"]); ws2.write(0, 3, "Election Day", F["h"])
    ws2.write(0, 4, "Total", F["h"])
    agg = {}
    for r in rows:
        a = agg.setdefault(r["precinct"], [0, 0, 0, 0])
        a[0] += r["mail"]; a[1] += r["early"]; a[2] += r["election_day"]; a[3] += r["total"]
    for i, p in enumerate(precincts, start=1):
        ws2.write(i, 0, p)
        for j, v in enumerate(agg[p], start=1):
            ws2.write_number(i, j, v, F["int"])
    ws2.freeze_panes(1, 1)
    ws2.autofilter(0, 0, len(precincts), 4)
    ws2.set_column(0, 0, 22); ws2.set_column(1, 4, 14)

    # pivot: contest x total
    ws3 = wb.add_worksheet("By Contest")
    ws3.write(0, 0, "Contest", F["h"]); ws3.write(0, 1, "Mail", F["h"])
    ws3.write(0, 2, "Early", F["h"]); ws3.write(0, 3, "Election Day", F["h"])
    ws3.write(0, 4, "Total", F["h"])
    agg2 = {}
    for r in rows:
        a = agg2.setdefault(r["contest"], [0, 0, 0, 0])
        a[0] += r["mail"]; a[1] += r["early"]; a[2] += r["election_day"]; a[3] += r["total"]
    for i, c in enumerate(sorted(agg2), start=1):
        ws3.write(i, 0, c)
        for j, v in enumerate(agg2[c], start=1):
            ws3.write_number(i, j, v, F["int"])
    ws3.freeze_panes(1, 1)
    ws3.autofilter(0, 0, len(agg2), 4)
    ws3.set_column(0, 0, 55); ws3.set_column(1, 4, 14)

    ws4 = wb.add_worksheet("Data")
    cols = ["Contest", "Candidate", "Party", "Precinct", "Mail", "Early", "Election Day", "Total", "%"]
    for j, c in enumerate(cols):
        ws4.write(0, j, c, F["h"])
    for i, r in enumerate(rows, start=1):
        ws4.write(i, 0, r["contest"]); ws4.write(i, 1, r["candidate"]); ws4.write(i, 2, r["party"])
        ws4.write(i, 3, r["precinct"])
        for j, k in [(4, "mail"), (5, "early"), (6, "election_day"), (7, "total")]:
            ws4.write_number(i, j, r[k], F["int"])
        ws4.write_number(i, 8, r["pct"], F["pct"])
    ws4.freeze_panes(1, 0)
    ws4.autofilter(0, 0, len(rows), len(cols) - 1)
    for j, w in enumerate([45, 32, 6, 18, 10, 10, 14, 12, 8]):
        ws4.set_column(j, j, w)

    wb.close()


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else "."
    raw_dir = os.path.join(dest, "raw")
    os.makedirs(raw_dir, exist_ok=True)
    out_dir = os.path.join(dest, "precincts")
    os.makedirs(out_dir, exist_ok=True)
    make_xlsx = os.environ.get("PRECINCT_XLSX", "1") != "0"
    pulled_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    cfg = json.load(open(CFG))
    results = {}
    with ThreadPoolExecutor(8) as ex:
        for res in ex.map(lambda kv: fetch(kv[0], kv[1], raw_dir), sorted(cfg.items())):
            results[res["code"]] = res

    ok, fails, total_rows, total_votes = 0, {}, 0, 0
    for code, res in results.items():
        if res["error"]:
            fails[code] = res["error"]
            continue
        ok += 1
        total_rows += len(res["rows"])
        total_votes += sum(r["total"] for r in res["rows"])
        if make_xlsx and res["rows"]:
            write_workbook(os.path.join(out_dir, f'{res["county"]}.xlsx'), res, pulled_at)

    print(f"  precincts: {ok}/{len(cfg)} counties, {total_rows:,} candidate-precinct rows, "
          f"{total_votes:,} votes")
    if fails:
        print(f"  precinct failures: {len(fails)} -> {list(fails.items())[:5]}")
    json.dump({"counties_ok": ok, "counties_configured": len(cfg),
               "rows": total_rows, "votes": total_votes, "failures": fails},
              open(os.path.join(dest, "precinct_summary.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
