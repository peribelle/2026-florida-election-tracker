#!/usr/bin/env python3
"""Audit every stored snapshot for wrong-election contamination.

Checks:
  1. every county id in raw/enr_ids.json still serves the 2026 general (11/3/2026)
  2. no archived county/precinct snapshot contains primary-only contest names
     (a primary shows up as "Governor (REP)", "State Representative 10 (DEM)"; the
     general shows plain "Governor and Lieutenant Governor")
  3. every county_enr_status.csv carries election_date = 11/3/2026
  4. the projection map is well formed and every archived projection snapshot
     uses a recognised race key (catches a slug silently falling back)

Exit code 1 if anything looks wrong, so it can gate a run.
"""
import csv, glob, json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
H = {"User-Agent": "Mozilla/5.0"}
GENERAL = {"11/3/2026", "11/03/2026"}
PRIMARY = re.compile(r"\((REP|DEM|UPC)\)\s*$")
RACE_KEY = re.compile(r"^FL-(GOV|SEN|CFO|AG|AGR|H\d{2})$")


def check_cfg():
    cfg = json.load(open(os.path.join(HERE, "raw", "enr_ids.json")))
    def one(kv):
        c, v = kv
        base = v.get("base", "https://enr.electionsfl.org").rstrip("/")
        u = f"{base}/{v.get('key', c)}/{v['id']}/Summary/"
        try:
            r = requests.get(u, headers=H, timeout=30)
            if r.status_code != 200:
                return c, f"HTTP {r.status_code}", u
            m = re.search(r"Election Date:\s*([\d/]+)", r.text)
            return c, (m.group(1) if m else "?"), u
        except Exception as e:
            return c, f"ERR {str(e)[:30]}", u
    with ThreadPoolExecutor(10) as ex:
        return list(ex.map(one, cfg.items()))


def scan_snapshots():
    bad = []
    for d in sorted(glob.glob(os.path.join(HERE, "results", "2026*"))):
        f = os.path.join(d, "county_contests.csv")
        if os.path.exists(f):
            rows = list(csv.DictReader(open(f)))
            n = sum(1 for r in rows if PRIMARY.search(r.get("contest", "")))
            if n:
                bad.append((os.path.basename(d), "county_contests", n))
        s = os.path.join(d, "county_enr_status.csv")
        if os.path.exists(s):
            for r in csv.DictReader(open(s)):
                ed = (r.get("election_date") or "").strip()
                if ed and ed not in GENERAL:
                    bad.append((os.path.basename(d), f"status {r['county_code']}", ed))
    for d in sorted(glob.glob(os.path.join(HERE, "results", "slow", "2026*"))):
        f = os.path.join(d, "summary.json")
        if not os.path.exists(f):
            continue
        for p in glob.glob(os.path.join(d, "precincts", "*.xlsx")):
            import openpyxl
            wb = openpyxl.load_workbook(p, read_only=True)
            if "Data" in wb.sheetnames:
                for row in wb["Data"].iter_rows(min_row=2, max_col=1, values_only=True):
                    if row[0] and PRIMARY.search(str(row[0])):
                        bad.append((os.path.basename(d), os.path.basename(p), "primary race"))
                        break
            wb.close()
    return bad


def check_projections():
    """Map integrity, and no archived snapshot using a slug instead of a race key."""
    bad = []
    try:
        cfg = json.load(open(os.path.join(HERE, "raw", "projection_map.json")))
    except Exception as e:
        return [("projection_map.json", "unreadable", str(e)[:40])]

    for entry in cfg.get("kalshi", {}).get("series", []):
        if not RACE_KEY.match(entry.get("race_key", "")):
            bad.append(("kalshi", entry.get("race_key"), "unknown race key"))
    for entry in cfg.get("polymarket", {}).get("events", []):
        if not RACE_KEY.match(entry.get("race_key", "")):
            bad.append(("polymarket", entry.get("race_key"), "unknown race key"))

    for d in sorted(glob.glob(os.path.join(HERE, "projections", "2026*"))):
        f = os.path.join(d, "predictions.csv")
        if not os.path.exists(f):
            continue
        for r in csv.DictReader(open(f)):
            k = (r.get("race_key") or "").strip()
            if k and not RACE_KEY.match(k):
                bad.append((os.path.basename(d), k, "race key fell back to slug"))
                break
    return bad


def main():
    print("1. config points at the 2026 general?")
    cfg = check_cfg()
    bad_cfg = [(c, d, u) for c, d, u in cfg if d not in GENERAL]
    print(f"   {len(cfg) - len(bad_cfg)}/{len(cfg)} ok"
          + (f"  PROBLEM: {bad_cfg}" if bad_cfg else ""))

    print("2. archived snapshots free of primary contests?")
    bad = scan_snapshots()
    print(f"   {'clean' if not bad else 'PROBLEM: ' + str(bad[:5])}")

    print("3. projection map and snapshots use recognised race keys?")
    bad_proj = check_projections()
    print(f"   {'clean' if not bad_proj else 'PROBLEM: ' + str(bad_proj[:5])}")

    if bad_cfg or bad or bad_proj:
        print("\nAUDIT FAILED")
        return 1
    print("\nAUDIT PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
