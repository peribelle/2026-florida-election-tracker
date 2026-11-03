#!/usr/bin/env python3
"""Write the county + elections-site list as CSV and Markdown."""
import csv, json, os
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sites = json.load(open(os.path.join(HERE, "raw", "sites.json")))
log = {r["code"]: r for r in json.load(open(os.path.join(HERE, "raw", "collect_log.json")))}
counties = {r["county"].upper(): r for r in csv.DictReader(open(os.path.join(HERE, "data", "counties.csv")))}
bt = {}
for r in csv.DictReader(open(os.path.join(HERE, "data", "by_type.csv"))):
    bt[r["county"].upper()] = bt.get(r["county"].upper(), 0) + int(r["ballots"])
DISP = {"DESOTO": "DeSoto", "MIAMI-DADE": "Miami-Dade"}
pretty = lambda c: DISP.get(c.upper(), c.title())

BROW = {"county": "Broward", "elig": 1103545, "ballots": 314113, "rate": 100 * 314113 / 1103545}

recs = []
for code, r in sorted(log.items(), key=lambda kv: kv[1]["county"]):
    nm = r["county"]
    if r["status"] == "ok":
        c = counties[nm.upper()]
        e = int(c["eligible_voters"]); b = bt.get(nm.upper(), 0)
        recs.append({"county": pretty(nm), "code": code, "site": sites[code]["site"],
                     "dash": f'https://tqv.vrswebapps.com/?state=FL&county={code}&election={r["election_number"]}',
                     "elig": e, "ballots": b, "rate": 100 * b / e if e else None, "status": "Full"})
    else:
        recs.append({"county": "Broward", "code": code, "site": sites[code]["site"],
                     "dash": "https://browardvotes.gov/voters/early-voting-ballot-return",
                     "elig": BROW["elig"], "ballots": BROW["ballots"], "rate": BROW["rate"],
                     "status": "Partial (mail not published)"})

out = os.path.join(HERE, "Reports", "county_election_sites.csv")
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["county", "code", "site", "dash", "elig", "ballots", "rate", "status"])
    w.writeheader(); w.writerows(recs)

md = os.path.join(HERE, "Reports", "counties_and_election_sites.md")
with open(md, "w") as f:
    f.write("# Florida's 67 counties — elections offices and live turnout pages\n\n")
    f.write(f"Compiled {datetime.now():%B %d, %Y}. Sources: FL Division of Elections supervisor directory; "
            "county turnout figures from each county's live feed.\n\n")
    f.write("| # | County | FIPS-style code | Elections website | Live turnout page | Eligible voters | Ballots cast | Turnout |\n")
    f.write("|---|--------|------|------------------|-------------------|----------------:|-------------:|--------:|\n")
    for i, r in enumerate(recs, 1):
        f.write(f'| {i} | {r["county"]} | {r["code"]} | {r["site"].replace("https://","")} | '
                f'[turnout]({r["dash"]}) | {r["elig"]:,} | {r["ballots"]:,} | {r["rate"]:.1f}% |\n')
    f.write(f'\n**Totals:** {sum(r["ballots"] for r in recs):,} ballots / '
            f'{sum(r["elig"] for r in recs):,} eligible voters = '
            f'{100*sum(r["ballots"] for r in recs)/sum(r["elig"] for r in recs):.2f}% turnout.\n')
print("WROTE", out, "and", md, "rows", len(recs))
