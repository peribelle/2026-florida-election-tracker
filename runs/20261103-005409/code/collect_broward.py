#!/usr/bin/env python3
"""Collect Broward from its own TEDElectionLink turnout dashboard.

Broward does not publish to the shared VR Systems feed, but its dashboard is
backed by a small JSON/HTML API:

  /TEDElectionLink/api/v1/widgets/chart?tile=<id>&dashboard=<dashboard>

KPI and pie tiles return JSON; data grids are server-rendered HTML tables that
are also embedded in the dashboard pages.

Outputs land in data/broward/ using the same column names as the TQV tables so
normalize.py can merge them without special-casing.
"""
import csv, html, json, os, re
import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "broward")
os.makedirs(OUT, exist_ok=True)

BASE = "https://my.browardvotes.gov/TEDElectionLink"
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
     "Accept": "text/html,application/json"}
COUNTY = "BROWARD"

# Broward party label -> FVRS-style code used everywhere else in this project
PARTY = {"Florida Democratic Party": "DEM", "Republican Party Of Florida": "REP",
         "No Party Affiliation": "NPA", "Other": "OTH"}


def _get(url, timeout=90):
    r = requests.get(url, headers=H, timeout=timeout)
    r.raise_for_status()
    return r


def tile(tid, dash):
    return _get(f"{BASE}/api/v1/widgets/chart?tile={tid}&dashboard={dash}", timeout=60).json()


def text_of(fragment):
    s = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def kpi(tid, dash):
    """Return the numeric value from a KPI tile."""
    t = text_of(tile(tid, dash).get("html", ""))
    m = re.search(r"(-?[\d,]+(?:\.\d+)?)\s*%?", t)
    return t, (m.group(1) if m else None)


def table_rows(fragment_html):
    soup = BeautifulSoup(fragment_html, "lxml")
    for tb in soup.find_all("table"):
        rows = [[c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
                for tr in tb.find_all("tr")]
        rows = [r for r in rows if r and any(r)]
        if rows:
            return rows
    return []


def page_tables(url):
    soup = BeautifulSoup(_get(url).text, "lxml")
    out = []
    for tb in soup.find_all("table"):
        rows = [[c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
                for tr in tb.find_all("tr")]
        rows = [r for r in rows if r and any(r)]
        if rows:
            out.append(rows)
    return out


def i(v):
    try:
        return int(str(v).replace(",", "").replace("%", "").strip())
    except Exception:
        return 0


def f(v):
    try:
        return float(str(v).replace(",", "").replace("%", "").strip())
    except Exception:
        return None


def main():
    # ---------- summary
    _, prec = kpi("sum01000000000000000000000000001", "turnout-summary")
    _, elig = kpi("sum02000000000000000000000000002", "turnout-summary")
    _, ball = kpi("sum03000000000000000000000000003", "turnout-summary")
    _, rate = kpi("sum04000000000000000000000000004", "turnout-summary")
    summary = {"county": COUNTY, "precincts": i(prec), "eligible_voters_allreg": i(elig),
               "ballots": i(ball), "turnout_pct_allreg": f(rate)}
    print(f"  summary: {summary}")

    # ---------- ballots by type (pie tile)
    pie = tile("sum05000000000000000000000000005", "turnout-summary").get("option", {})
    types = {}
    for s in pie.get("series", []):
        for d in s.get("data", []):
            nm = str(d.get("name", "")).strip()
            key = {"Vote By Mail": "Mail", "Early Vote": "EarlyVoting",
                   "Election Day": "ElectionDay", "Provisional": "Provisional"}.get(nm, nm)
            types[key] = types.get(key, 0) + int(d.get("value") or 0)
    with open(os.path.join(OUT, "by_type.csv"), "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["county", "ballot_type", "ballots"])
        for k, v in types.items():
            w.writerow([COUNTY, k, v])
    print(f"  by type: {types}")

    # ---------- party grid
    rows = table_rows(tile("ptq06000000000000000000000000006", "turnout-party").get("html", ""))
    party_rows = []
    for r in rows:
        if len(r) < 7 or r[0] == "Party":
            continue
        code = PARTY.get(r[0])
        if not code:
            continue
        party_rows.append({
            "county": COUNTY, "party_code": code,
            "mail": i(r[2]), "earlyvoting": i(r[3]),
            "electionday": i(r[4]), "provisional": 0, "total": i(r[5]),
            "eligible_allreg": i(r[1]),
        })
    with open(os.path.join(OUT, "by_party.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(party_rows[0]))
        w.writeheader(); w.writerows(party_rows)
    print(f"  by party: {len(party_rows)} rows")

    # ---------- precincts
    tabs = page_tables(f"{BASE}/TurnOutWidget/dashboard/view/precinct-turnout")
    prow = []
    for r in (tabs[0] if tabs else []):
        if len(r) < 8 or r[0] == "Precinct":
            continue
        prow.append({
            "county": COUNTY, "precinct_key": r[0], "location": r[1],
            "eligible_voters": i(r[2]), "mail": i(r[3]), "earlyvoting": i(r[4]),
            "electionday": i(r[5]), "provisional": 0, "total": i(r[6]),
            "turnout_pct": f(r[7]),
        })
    with open(os.path.join(OUT, "by_precinct.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(prow[0]))
        w.writeheader(); w.writerows(prow)
    print(f"  precincts: {len(prow)} (ballots {sum(x['total'] for x in prow):,})")

    # ---------- locations: table 0 = early voting by party, table 1 = election day by precinct
    tabs = page_tables(f"{BASE}/TurnOutWidget/dashboard/view/turnout-location")
    loc, lp = [], []
    if tabs:
        for r in tabs[0]:
            if len(r) < 6 or r[0] == "Voting Location":
                continue
            nm = r[0]
            lid = f"EV{abs(hash(nm)) % 100000:05d}"
            loc.append({"county": COUNTY, "location_id": lid, "kind": "Early Voting",
                        "name": nm, "address": ""})
            for col, code in ((1, "DEM"), (2, "REP"), (3, "NPA"), (4, "OTH")):
                v = i(r[col])
                if v:
                    lp.append({"county": COUNTY, "location_id": lid,
                               "party_code": code, "ballots": v})
    if len(tabs) > 1:
        for r in tabs[1]:
            if len(r) < 7 or r[0] == "Voting Location":
                continue
            nm = r[0]
            lid = f"ED{abs(hash(nm)) % 100000:05d}"
            precincts = r[1] if len(r) > 1 else ""
            loc.append({"county": COUNTY, "location_id": lid, "kind": "Election Day",
                        "name": nm, "address": f"Precincts: {precincts}"})
    with open(os.path.join(OUT, "by_location.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["county", "location_id", "kind", "name", "address"])
        w.writeheader(); w.writerows(loc)
    with open(os.path.join(OUT, "location_party.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["county", "location_id", "party_code", "ballots"])
        w.writeheader(); w.writerows(lp)
    print(f"  locations: {len(loc)} ({sum(1 for x in loc if x['kind']=='Early Voting')} EV, "
          f"{sum(1 for x in loc if x['kind']=='Election Day')} ED)")

    # ---------- daily totals
    j = tile("view-dayvotes-0001", "turnout-day")
    h = html.unescape(j.get("html", ""))
    daily = []
    k = h.find('{"option"')
    if k >= 0:
        opt = json.JSONDecoder().raw_decode(h[k:])[0]["option"]
        dates = opt["xAxis"]["data"]
        for s in opt.get("series", []):
            vals = [d.get("value") if isinstance(d, dict) else d for d in s.get("data", [])]
            for dt, v in zip(dates, vals):
                if not dt or dt.startswith("00/00") or not v:
                    continue
                daily.append({"county": COUNTY, "date": dt, "ballot_type": "All", "ballots": int(v)})
    with open(os.path.join(OUT, "by_date.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["county", "date", "ballot_type", "ballots"])
        w.writeheader(); w.writerows(daily)
    print(f"  daily rows: {len(daily)}")

    summary["types"] = types
    summary["ev_locations"] = sum(1 for x in loc if x["kind"] == "Early Voting")
    summary["ed_locations"] = sum(1 for x in loc if x["kind"] == "Election Day")
    summary["has_party"] = bool(party_rows)
    summary["has_precinct"] = bool(prow)
    json.dump(summary, open(os.path.join(OUT, "summary.json"), "w"), indent=1)
    print(f"  -> {OUT}")


if __name__ == "__main__":
    main()
