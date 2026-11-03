#!/usr/bin/env python3
"""Precinct-level results for counties that don't publish the CSV export.

Runs on a slower cadence (:15 and :45) because it costs one request per contest
per county instead of one per county.

Strategy per county:
  * read the Summary page to map contest id -> contest name (favorite-<id>)
  * fetch {base}/{key}/{id}/Precincts/<contest>/ for each contest
  * each page holds one block per precinct: .PrecinctName + a results table
  * write <County>.xlsx with the same four sheets as the fast path, plus a
    gzipped long CSV

Only counties whose Reports page has no precinct CSV are processed.
"""
import csv, gzip, json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import requests
import xlsxwriter
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "raw", "enr_ids.json")
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}

sys.path.insert(0, HERE)
from results_precinct import NAMES, num, write_workbook  # reuse formatting


def url(cfg, code, suffix=""):
    base = cfg.get("base", "https://enr.electionsfl.org").rstrip("/")
    key = cfg.get("key", code)
    return f"{base}/{key}/{cfg['id']}/{suffix}"


def has_csv_export(cfg, code):
    try:
        r = requests.get(url(cfg, code, "Reports/"), headers=H, timeout=30)
        return r.status_code == 200 and "CandidateResultsbyPrecinctandParty" in r.text
    except Exception:
        return False


def contests_for(cfg, code):
    r = requests.get(url(cfg, code, "Summary/"), headers=H, timeout=45)
    if r.status_code != 200:
        return []
    if "11/3/2026" not in r.text and "11/03/2026" not in r.text:
        print(f"  ! {code}: summary page is not the 2026 general - skipped")
        return []
    s = BeautifulSoup(r.text, "lxml")
    out = []
    for hdr in s.find_all("div", class_="RaceHeader"):
        cb = hdr.find("input", id=re.compile(r"favorite-\d+"))
        nm = hdr.find(class_="RaceName")
        if not (cb and nm):
            continue
        name = nm.get_text(" ", strip=True).replace("Add or Take Out of Favorite Races", "").strip()
        out.append((cb["id"].split("-")[1], name))
    return out


def parse_contest(cfg, code, cid, cname):
    try:
        r = requests.get(url(cfg, code, f"Precincts/{cid}/"), headers=H, timeout=120)
        if r.status_code != 200:
            return []
    except Exception:
        return []
    s = BeautifulSoup(r.text, "lxml")
    rows = []
    for block in s.find_all("div", class_="Race row"):
        nm = block.find(class_="PrecinctName")
        precinct = nm.get_text(" ", strip=True) if nm else ""
        for tr in block.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if len(cells) < 6 or not cells[0] or cells[0].lower().startswith("choice"):
                continue
            choice = cells[0]
            m = re.search(r"\((REP|DEM|NPA|LPF|GRE|CPF|AMF|ASP|BPP|CPP|CSV|ECO|FFP|IND|JEF|MGT|PSL|WTP|WPF|AIP|OTH)\)\s*$", choice, re.I)
            rows.append({
                "contest": cname, "candidate": re.sub(r"\s*\([A-Z]{3}\)\s*$", "", choice).strip(),
                "party": m.group(1).upper() if m else "", "precinct": precinct,
                "mail": num(cells[3]), "early": num(cells[2]),
                "election_day": num(cells[1]),
                "provisional": num(cells[4]),
                "total": num(cells[5]),
                "pct": num(cells[6]) if len(cells) > 6 else 0,
            })
    return rows


def main():
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    root = os.path.join(HERE, "results", "slow")
    dest = os.path.join(root, stamp)
    os.makedirs(os.path.join(dest, "raw"), exist_ok=True)
    os.makedirs(os.path.join(dest, "precincts"), exist_ok=True)

    cfg = json.load(open(CFG))
    only = os.environ.get("SLOW_COUNTIES")
    if only:
        cfg = {k: v for k, v in cfg.items() if k in only.split(",")}

    # counties that need the slow path
    with ThreadPoolExecutor(8) as ex:
        have_csv = dict(zip(cfg.keys(),
                            ex.map(lambda kv: has_csv_export(kv[1], kv[0]), cfg.items())))
    targets = [c for c in cfg if not have_csv.get(c)]
    print(f"  slow precinct: {len(targets)} counties without CSV export: {', '.join(sorted(targets))}")

    jobs = []
    with ThreadPoolExecutor(8) as ex:
        for code, cons in zip(targets, ex.map(lambda c: contests_for(cfg[c], c), targets)):
            for cid, name in cons:
                jobs.append((code, cid, name))

    print(f"  fetching {len(jobs)} contest precinct pages...")
    grouped = {c: [] for c in targets}
    with ThreadPoolExecutor(10) as ex:
        for (code, cid, name), rows in zip(jobs, ex.map(lambda j: parse_contest(cfg[j[0]], *j), jobs)):
            grouped[code].extend(rows)

    ok, fails, total = 0, {}, 0
    pulled_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for code in targets:
        rows = grouped.get(code) or []
        if not rows:
            fails[code] = "no rows"
            continue
        ok += 1
        total += len(rows)
        county = NAMES.get(code, code)
        with gzip.open(os.path.join(dest, "raw", f"precinct_{code}.csv.gz"), "wt", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader(); w.writerows(rows)
        write_workbook(os.path.join(dest, "precincts", f"{county}.xlsx"),
                       {"code": code, "county": county, "rows": rows,
                        "csv_url": url(cfg[code], code, "Precincts/")}, pulled_at)

    summary = {"run_id": stamp, "created_local": pulled_at, "counties_ok": ok,
               "counties_targeted": len(targets), "rows": total, "failures": fails}
    json.dump(summary, open(os.path.join(dest, "summary.json"), "w"), indent=1)

    idx = os.path.join(root, "INDEX.csv")
    new = not os.path.exists(idx)
    with open(idx, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["run_id", "created_local", "counties_ok",
                                          "counties_targeted", "rows"])
        if new:
            w.writeheader()
        w.writerow({"run_id": stamp, "created_local": pulled_at, "counties_ok": ok,
                    "counties_targeted": len(targets), "rows": total})

    print(f"  slow precinct: {ok}/{len(targets)} counties, {total:,} rows -> results/slow/{stamp}/")


if __name__ == "__main__":
    main()
