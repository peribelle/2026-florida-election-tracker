#!/usr/bin/env python3
"""Snapshot Florida Election Watch - the state's public election-night feed.

Sources (all public, no credentials):
  /CountyReportingStatus   per-county turnout, eligible voters, precincts reported,
                           VBM / early / provisional ballots completed
  /ElectionDayTurnout      per-county turnout + last-reported time
  /ContestResultsByCounty/<id>   votes by county for one contest

Each run writes results/<local timestamp>/ with parsed CSVs, a summary.json and
the raw HTML (gzipped), then appends a row to results/INDEX.csv. Nothing is
ever overwritten.
"""
import csv, gzip, json, os, re, sys, time
from datetime import datetime, timezone
import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://floridaelectionwatch.gov"
OUT = os.path.join(HERE, "results")
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
     "Accept": "text/html"}

MAX_CONTESTS = int(os.environ.get("CONTEST_LIMIT", "250"))
OFFICE_PAGES = ["/StateOffices", "/FederalOffices",
                "/DistrictOffices/StateSenator", "/DistrictOffices/StateRepresentative",
                "/JudicialOffices/SupremeCourt", "/JudicialOffices/DistrictCourtOfAppeal",
                "/JudicialOffices/CircuitCourt", "/Amendments"]


def get(path, tries=3):
    url = path if path.startswith("http") else BASE + path
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, headers=H, timeout=45)
            if r.status_code == 200:
                return r.text
            last = f"HTTP {r.status_code}"
        except Exception as e:
            last = str(e)[:80]
        time.sleep(1.5 * (i + 1))
    print(f"  ! {url}: {last}")
    return None


def cells(tr):
    return [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]


def num(s):
    s = (s or "").replace(",", "").replace("%", "").strip()
    if s in ("", "-", "--"):
        return None
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return None


def parse_county_status(html_):
    """County Reporting Status -> per-county turnout detail."""
    s = BeautifulSoup(html_, "lxml")
    tb = s.find("table")
    if not tb:
        return []
    rows = [cells(tr) for tr in tb.find_all("tr")]
    header = rows[0]
    out = []
    for r in rows[1:]:
        if len(r) < 6 or not r[0]:
            continue
        out.append({
            "county": r[0].strip(),
            "voter_turnout": num(r[1]),
            "eligible_active": num(r[2]),
            "turnout_pct": num(r[3]),
            "precincts_reporting_pct": num(r[4]),
            "precincts_completed_pct": num(r[5]),
            "vbm_completed": num(r[6]) if len(r) > 6 else None,
            "early_completed": num(r[7]) if len(r) > 7 else None,
            "provisional_completed": num(r[8]) if len(r) > 8 else None,
            "overseas_10day": num(r[9]) if len(r) > 9 else None,
        })
    return out


def parse_ed_turnout(html_):
    s = BeautifulSoup(html_, "lxml")
    tb = s.find("table")
    if not tb:
        return []
    out = []
    for r in [cells(tr) for tr in tb.find_all("tr")][1:]:
        if len(r) < 3 or not r[0]:
            continue
        out.append({"county": r[0].strip(), "turnout": num(r[1]),
                    "last_reported": r[2].strip(),
                    "time_zone": r[3].strip() if len(r) > 3 else ""})
    return out


def discover_contests():
    ids = {}
    for p in OFFICE_PAGES:
        html_ = get(p)
        if not html_:
            continue
        for cid in re.findall(r"/ContestResultsByCounty/(\d+)", html_):
            ids.setdefault(cid, None)
    return list(ids)[:MAX_CONTESTS]


def parse_contest(html_, cid):
    s = BeautifulSoup(html_, "lxml")
    title = ""
    el = s.find(class_="titleDescription")
    if el:
        title = el.get_text(" ", strip=True)
    sub = s.find(class_="sub-title")
    if sub and title:
        title = f"{title} ({sub.get_text(' ', strip=True)})"
    tb = None
    for t in s.find_all("table"):
        rows = [cells(tr) for tr in t.find_all("tr")]
        if rows and len(rows[0]) > 2 and rows[0][0].lower().startswith("county"):
            tb = rows
            break
    if not tb:
        return title, []
    header = tb[0][1:]
    cands = []
    for hcell in header:
        m = re.match(r"^(.*?)\s*\(([A-Z]{3})\)\s*$", hcell)
        cands.append({"candidate": (m.group(1) if m else hcell).strip(),
                      "party": (m.group(2) if m else "")})
    out = []
    for r in tb[1:]:
        if not r or not r[0]:
            continue
        county = r[0].strip()
        if county.rstrip(":").strip().upper() in ("TOTAL", "TOTALS", "STATEWIDE"):
            county = "TOTAL"
        for c, cell in zip(cands, r[1:]):
            v = num(cell)
            if v is None:
                continue
            out.append({"contest_id": cid, "contest": title, "county": county,
                        "candidate": c["candidate"], "party": c["party"], "votes": v})
    return title, out


def main():
    now_local = datetime.now()
    now_utc = datetime.now(timezone.utc)
    run_id = now_local.strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(OUT, run_id)
    os.makedirs(dest, exist_ok=False)

    raw = os.path.join(dest, "raw")
    os.makedirs(raw)

    def save(name, html_):
        if html_:
            with gzip.open(os.path.join(raw, name + ".html.gz"), "wt", encoding="utf-8") as f:
                f.write(html_)

    print(f"  snapshot {run_id}")

    status_html = get("/CountyReportingStatus")
    save("county_status", status_html)
    status = parse_county_status(status_html or "")

    ed_html = get("/ElectionDayTurnout")
    save("ed_turnout", ed_html)
    ed = parse_ed_turnout(ed_html or "")

    contests = discover_contests()

    def fetch(cid):
        return cid, get(f"/ContestResultsByCounty/{cid}")

    all_votes = []
    contest_titles = {}
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(8) as ex:
        for cid, html_ in ex.map(fetch, contests):
            save(f"contest_{cid}", html_)
            if not html_:
                continue
            title, rows = parse_contest(html_, cid)
            contest_titles[cid] = title
            all_votes.extend(rows)

    for name, rows in (("county_status", status), ("ed_turnout", ed),
                       ("contest_votes", all_votes)):
        if not rows:
            continue
        with open(os.path.join(dest, name + ".csv"), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader(); w.writerows(rows)

    statewide = {}
    for r in all_votes:
        if r["county"].upper() in ("TOTAL", "TOTALS", "STATEWIDE"):
            k = (r["contest"], r["candidate"], r["party"])
            statewide[k] = r["votes"]
    def total_row(rows, key):
        for r in rows:
            if str(r.get("county", "")).strip().rstrip(":").strip().upper() in ("TOTAL", "TOTALS"):
                return r
        return None

    trow = total_row(status, "voter_turnout")
    votes_total = ((trow or {}).get("voter_turnout")
                   or sum(s["voter_turnout"] or 0 for s in status
                          if str(s["county"]).upper() != "TOTAL"))
    elig_total = ((trow or {}).get("eligible_active")
                  or sum(s["eligible_active"] or 0 for s in status
                         if str(s["county"]).upper() != "TOTAL"))

    county_stats, precinct_stats = {}, {}
    try:
        import subprocess
        # both local pulls run in parallel: every contest, and precinct detail
        prec = subprocess.Popen([sys.executable, os.path.join(HERE, "results_precinct.py"), dest],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        out = subprocess.run([sys.executable, os.path.join(HERE, "results_county.py"), dest],
                             capture_output=True, text=True, timeout=600)
        for line in out.stdout.splitlines():
            if "county ENR:" in line:
                print(line)
        try:
            pout, _ = prec.communicate(timeout=900)
        except subprocess.TimeoutExpired:
            prec.kill(); pout = ""
        for line in (pout or "").splitlines():
            if line.strip().startswith("precinct"):
                print(line)
        for name, key in (("county_enr_summary.json", "county_stats"),
                          ("precinct_summary.json", "precinct_stats")):
            p = os.path.join(dest, name)
            if os.path.exists(p):
                if key == "county_stats":
                    county_stats = json.load(open(p))
                else:
                    precinct_stats = json.load(open(p))
    except Exception as e:
        print(f"  ! county pulls failed: {str(e)[:80]}")

    summary = {
        "run_id": run_id,
        "county_enr": county_stats,
        "precincts": precinct_stats, "created_local": now_local.isoformat(timespec="seconds"),
        "created_utc": now_utc.isoformat(timespec="seconds"),
        "counties_reporting": sum(1 for s in status if (s["voter_turnout"] or 0) > 0),
        "ballots": votes_total, "eligible": elig_total,
        "turnout_pct": round(100 * votes_total / elig_total, 4) if elig_total else None,
        "contests": contest_titles, "statewide": [
            {"contest": k[0], "candidate": k[1], "party": k[2], "votes": v}
            for k, v in sorted(statewide.items(), key=lambda kv: -kv[1])],
        "files": sorted(os.listdir(dest)),
    }
    json.dump(summary, open(os.path.join(dest, "summary.json"), "w"), indent=1)

    idx = os.path.join(OUT, "INDEX.csv")
    row = {"run_id": run_id, "created_local": summary["created_local"],
           "created_utc": summary["created_utc"], "ballots": votes_total,
           "eligible": elig_total, "turnout_pct": summary["turnout_pct"],
           "counties_reporting": summary["counties_reporting"],
           "contests_with_votes": len([1 for k, v in statewide.items() if v]),
           "county_enr_ok": county_stats.get("counties_ok", 0),
           "precinct_ok": precinct_stats.get("counties_ok", 0),
           "precinct_rows": precinct_stats.get("rows", 0),
           "note": ""}

    # append, migrating the header if new columns appeared
    rows, fields = [], list(row)
    if os.path.exists(idx):
        with open(idx) as f:
            rd = csv.DictReader(f)
            fields = list(rd.fieldnames or []) + [k for k in row if k not in (rd.fieldnames or [])]
            rows = [{k: v for k, v in r.items() if k is not None} for r in rd]
    rows.append(row)
    with open(idx, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    print(f"  ballots {votes_total:,} / eligible {elig_total:,} "
          f"({summary['turnout_pct']}%)  counties reporting {summary['counties_reporting']}/67")
    print(f"  contests polled {len(contests)}, statewide totals {len(statewide)}")
    if county_stats:
        print(f"  county races: {county_stats.get('contests',0)} contests across "
              f"{county_stats.get('counties_ok',0)} counties")
    if precinct_stats:
        print(f"  precinct detail: {precinct_stats.get('counties_ok',0)} counties, "
              f"{precinct_stats.get('rows',0):,} candidate-precinct rows")
    print(f"  -> results/{run_id}/")

    # Keep Reports/viewer.html current through the night. Detached and time-limited, so it can never delay or
    # break a pull: the pull above is already on disk. The build reads runs/, results/ and projections/ only.
    try:
        import subprocess
        os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
        subprocess.Popen(["timeout", "180", sys.executable, os.path.join(HERE, "build_viewer.py")], cwd=HERE,
                         stdout=open(os.path.join(HERE, "logs", "viewer_build.log"), "a"), stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL, start_new_session=True)
    except Exception as e:
        print(f"  ! viewer rebuild not started: {str(e)[:80]}")

    # Then publish: commit this pull and the rebuilt page and push them. publish.py runs detached, waits for the files to
    # settle and takes a lock, so it can never delay or break a pull. NO_PUBLISH=1 skips it.
    try:
        from publish import queue_publish
        queue_publish()
    except Exception as e:
        print(f"  ! publish not queued: {str(e)[:80]}")


if __name__ == "__main__":
    main()
