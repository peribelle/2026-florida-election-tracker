#!/usr/bin/env python3
"""Normalize the 66 TQV county files into tidy tables."""
import json, os, glob, csv
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "data")
os.makedirs(OUT, exist_ok=True)

PARTY = {
 "DEM":"Democratic","REP":"Republican","NPA":"No Party Affiliation","IND":"Independent",
 "LPF":"Libertarian","GRE":"Green","CPF":"Constitution","AMF":"America First",
 "ASP":"American Solidarity","BPP":"Boricua","CPP":"Coalition With A Purpose",
 "CSV":"Conservative","ECO":"Ecology","FFP":"Florida Forward","PSL":"Party for Socialism & Liberation",
 "REF":"Reform","UTY":"Unity","WPF":"Working Families","DMP":"Democratic?","NLP":"Natural Law",
}
TYPES = ["Mail","EarlyVoting","ElectionDay","Provisional"]

def load_all():
    rows = []
    for fn in sorted(glob.glob(os.path.join(RAW, "tqv", "*.json"))):
        d = json.load(open(fn))
        rows.append((os.path.basename(fn).split("_")[0], d))
    return rows

def main():
    counties, by_party, by_type, by_precinct, by_location, by_date, loc_party, loc_day = [],[],[],[],[],[],[],[]
    for code, d in load_all():
        s = d["Summary"]; cname = s["CountyName"]
        t = d.get("Turnout", {})
        counties.append({
            "code": code, "county": cname,
            "election": s.get("ElectionName"), "election_date": s.get("ElectionDate"),
            "eligible_voters": s.get("TotalRegisteredVoters"),
            "last_updated": s.get("LastUpdatedTime"),
            "tabs": "|".join(sorted(t.keys())),
            "precincts": len(t.get("PrecinctType", {})),
            "locations_ev": len(d.get("Location",{}).get("EarlyVoting",{})),
            "locations_ed": len(d.get("Location",{}).get("ElectionDay",{})),
        })
        # --- by party
        pt = t.get("PartyType", {})
        reg_by_party = defaultdict(int)
        for k,v in t.get("PrecinctType", {}).items():
            pass  # precinct file has no party split
        for p, v in pt.items():
            row = {"county": cname, "party_code": p, "party": PARTY.get(p, p)}
            tot = 0
            for ty in TYPES:
                n = v.get(ty, 0) or 0
                row[ty.lower()] = n; tot += n
            row["total"] = tot
            by_party.append(row)
        # --- by type
        vt = defaultdict(int)
        for p, v in pt.items():
            for ty, n in v.items(): vt[ty] += n or 0
        for ty, n in vt.items():
            by_type.append({"county": cname, "ballot_type": ty, "ballots": n})
        # --- by precinct (+ type)
        for pc, v in t.get("PrecinctType", {}).items():
            bt = v.get("BallotTypeTotals", {}) or {}
            elig = v.get("EligibleVoters", 0) or 0
            row = {"county": cname, "precinct_key": pc, "eligible_voters": elig}
            tot = 0
            for ty in TYPES:
                n = bt.get(ty, 0) or 0
                row[ty.lower()] = n; tot += n
            row["total"] = tot
            row["turnout_pct"] = round(100*tot/elig, 2) if elig else None
            by_precinct.append(row)
        # --- locations
        loc = d.get("Location", {})
        for lk, kind in (("EarlyVoting","Early Voting"), ("ElectionDay","Election Day")):
            for lid, info in (loc.get(lk) or {}).items():
                by_location.append({"county": cname, "location_id": lid, "kind": kind,
                                    "name": info.get("Name"), "address": info.get("Address")})
        # --- by date
        for dt, v in t.get("DateType", {}).items():
            for ty, n in v.items():
                by_date.append({"county": cname, "date": dt, "ballot_type": ty, "ballots": n or 0})
        # --- location x party
        for kind_key in ("LocationParty","LocationDay"):
            pass
        for lid, v in (t.get("LocationParty", {}).get("EarlyVoting") or {}).items():
            for p, n in v.items():
                loc_party.append({"county": cname, "location_id": lid,
                                  "party_code": p, "party": PARTY.get(p,p), "ballots": n or 0})
        for lid, days in (t.get("LocationDay", {}).get("EarlyVoting") or {}).items():
            for dt, parties in days.items():
                tot = sum((n or 0) for n in parties.values())
                loc_day.append({"county": cname, "location_id": lid, "date": dt, "ballots": tot})

    # ---- merge Broward (its own dashboard, same tidy schema)
    bro_dir = os.path.join(OUT, "broward")
    if os.path.exists(os.path.join(bro_dir, "summary.json")):
        summ = json.load(open(os.path.join(bro_dir, "summary.json")))
        def rd(fn):
            return list(csv.DictReader(open(os.path.join(bro_dir, fn))))
        for r in rd("by_type.csv"):
            by_type.append({"county": "BROWARD", "ballot_type": r["ballot_type"],
                            "ballots": int(r["ballots"])})
        for r in rd("by_party.csv"):
            by_party.append({"county": "BROWARD", "party_code": r["party_code"],
                             "party": PARTY.get(r["party_code"], r["party_code"]),
                             "mail": int(r["mail"]), "earlyvoting": int(r["earlyvoting"]),
                             "electionday": int(r["electionday"]),
                             "provisional": int(r["provisional"]), "total": int(r["total"])})
        for r in rd("by_precinct.csv"):
            by_precinct.append({**r, "county": "BROWARD"})
        for r in rd("by_location.csv"):
            by_location.append(r)
        for r in rd("location_party.csv"):
            lp = dict(r); lp["party"] = PARTY.get(r["party_code"], r["party_code"])
            loc_party.append(lp)
        for r in rd("by_date.csv"):
            by_date.append({**r, "county": "BROWARD"})
        tot = sum(int(r["ballots"]) for r in rd("by_type.csv"))
        counties.append({
            "code": "BRO", "county": "BROWARD", "election": "2026 General Election",
            "election_date": "11/03/2026",
            "eligible_voters": summ["eligible_voters_allreg"],
            "last_updated": "live dashboard",
            "tabs": "Summary|Type|Party|Precinct|Location|Day",
            "precincts": summ["precincts"], "locations_ev": summ["ev_locations"],
            "locations_ed": summ["ed_locations"],
            "eligible_basis": "all registered",
        })
    else:
        print("WARN: no Broward data in data/broward")

    def dump(name, rows, cols=None):
        p = os.path.join(OUT, name + ".csv")
        if not rows: print("EMPTY", name); return
        cols = cols or list(rows[0].keys())
        with open(p, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols); w.writeheader()
            for r in rows: w.writerow({c: r.get(c) for c in cols})
        print(f"{name}: {len(rows)} rows -> {p}")

    for c in counties:
        c.setdefault("eligible_basis", "active registered")
    dump("counties", counties)
    dump("by_party", by_party, ["county","party_code","party","mail","earlyvoting","electionday","provisional","total"])
    dump("by_type", by_type, ["county","ballot_type","ballots"])
    dump("by_precinct", by_precinct, ["county","precinct_key","location","eligible_voters","mail","earlyvoting","electionday","provisional","total","turnout_pct"])
    dump("by_location", by_location, ["county","location_id","kind","name","address"])
    dump("by_date", by_date, ["county","date","ballot_type","ballots"])
    dump("location_party", loc_party, ["county","location_id","party_code","party","ballots"])
    dump("location_day", loc_day, ["county","location_id","date","ballots"])

if __name__ == "__main__":
    main()
