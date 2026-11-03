#!/usr/bin/env python3
"""Pull every contest in every county from the Clarity ENR pages.

One request per county returns the whole local ballot: county commission,
sheriff, school board, soil & water, judges, municipal races and ballot
questions, alongside the state and federal contests.

Reads raw/enr_ids.json for {county: {id, base}}. Writes into the current
results snapshot directory passed as argv[1].
"""
import json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "raw", "enr_ids.json")
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
     "Accept": "text/html"}

PARTY = re.compile(r"\((REP|DEM|NPA|LPF|GRE|CPF|AMF|ASP|BPP|CPP|CSV|ECO|FFP|IND|JEF|MGT|PSL|WTP|WPF|AIP|OTH)\)\s*$", re.I)


def num(s):
    s = (s or "").replace(",", "").replace("%", "").strip()
    if s in ("", "-", "--"):
        return 0
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return 0


def parse_county(code, cfg, timeout=30):
    base = cfg.get("base", "https://enr.electionsfl.org").rstrip("/")
    eid = cfg["id"]
    url = f"{base}/{code}/{eid}/Summary/"
    out = {"code": code, "url": url, "contests": [], "status": None, "error": None}
    try:
        r = requests.get(url, headers=H, timeout=timeout)
        if r.status_code != 200:
            out["error"] = f"HTTP {r.status_code}"
            return out
    except Exception as e:
        out["error"] = str(e)[:60]
        return out

    soup = BeautifulSoup(r.text, "lxml")
    text = soup.get_text(" ", strip=True)

    mdate = re.search(r"Election Date:\s*([\d/]+)", text)
    edate = mdate.group(1) if mdate else ""
    if edate and edate not in ("11/3/2026", "11/03/2026"):
        out["error"] = f"wrong election ({edate})"
        return out

    def grab(label, pattern=r"([\d,]+|[\d.]+%)"):
        m = re.search(re.escape(label) + r"\s*:?\s*" + pattern, text)
        return m.group(1) if m else None

    out["status"] = {
        "county_code": code,
        "registered": num(grab("Registered Voters")),
        "ballots_cast": num(grab("Ballots Cast")),
        "turnout_pct": num(grab("Voter Turnout")),
        "precincts_reporting": grab("Precincts Reporting", r"([\d,]+)\s*/\s*[\d,]+"),
        "precincts_total": grab("Precincts Reporting", r"[\d,]+\s*/\s*([\d,]+)"),
        "last_updated": (re.search(r"last updated at:\s*([^)]+)\)", text).group(1).strip()
                         if "last updated at:" in text else None),
        "election_date": edate,
        "url": url,
    }

    for hdr in soup.find_all("div", class_="RaceHeader"):
        name_el = hdr.find(class_="RaceName")
        if not name_el:
            continue
        labels = [l.get_text(" ", strip=True) for l in name_el.find_all("label")]
        race = labels[-1].strip() if labels else name_el.get_text(" ", strip=True)
        race = re.sub(r"\s+", " ", race).strip()
        tb = hdr.find_next("table")
        if not tb:
            continue
        for tr in tb.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if len(cells) < 5:
                continue
            choice = cells[0].strip()
            if not choice or choice.lower().startswith("choice"):
                continue
            m = PARTY.search(choice)
            party = m.group(1).upper() if m else ""
            cand = PARTY.sub("", choice).strip()
            out["contests"].append({
                "county_code": code, "contest": race, "candidate": cand, "party": party,
                "election_day": num(cells[1]) if len(cells) > 1 else 0,
                "early": num(cells[2]) if len(cells) > 2 else 0,
                "mail": num(cells[3]) if len(cells) > 3 else 0,
                "provisional": num(cells[4]) if len(cells) > 4 else 0,
                "total": num(cells[5]) if len(cells) > 5 else 0,
                "pct": num(cells[6]) if len(cells) > 6 else 0,
            })
    return out


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else "."
    cfg = json.load(open(CFG))
    print(f"  county ENR: {len(cfg)} counties configured")

    results = {}
    with ThreadPoolExecutor(10) as ex:
        for res in ex.map(lambda kv: parse_county(kv[0], kv[1]), sorted(cfg.items())):
            results[res["code"]] = res

    votes, status = [], []
    for code, res in results.items():
        votes.extend(res["contests"])
        if res["status"]:
            status.append(res["status"])

    import csv
    if votes:
        with open(os.path.join(dest, "county_contests.csv"), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(votes[0]))
            w.writeheader(); w.writerows(votes)
    if status:
        with open(os.path.join(dest, "county_enr_status.csv"), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(status[0]))
            w.writeheader(); w.writerows(status)

    ok = sum(1 for r in results.values() if r["status"])
    bad = {c: r["error"] for c, r in results.items() if r["error"]}
    total_votes = sum(v["total"] for v in votes)
    contests = len({(v["county_code"], v["contest"]) for v in votes})
    print(f"  county ENR: {ok}/{len(cfg)} counties parsed, {contests} contests, "
          f"{total_votes:,} votes")
    if bad:
        print(f"  county ENR failures: {len(bad)} -> {list(bad.items())[:5]}")

    json.dump({"counties_ok": ok, "counties_configured": len(cfg),
               "contests": contests, "votes": total_votes, "failures": bad},
              open(os.path.join(dest, "county_enr_summary.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
