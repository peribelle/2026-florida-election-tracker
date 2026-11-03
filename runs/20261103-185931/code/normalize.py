#!/usr/bin/env python3
"""Normalize the 66 TQV county files into tidy tables."""
import json, os, glob, csv, shutil
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "data")
os.makedirs(OUT, exist_ok=True)
LAST_GOOD = os.path.join(RAW, "broward_last_good")          # Broward's last files that parsed cleanly, in case data/broward ever does not
BRO_FILES = ("by_type.csv", "by_party.csv", "by_precinct.csv", "by_location.csv", "location_party.csv", "by_date.csv", "summary.json")

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

def remember_good(bro_dir):
    """Keep a copy of Broward's files that just parsed cleanly, so a later bad file can fall back to them."""
    os.makedirs(LAST_GOOD, exist_ok=True)
    for n in BRO_FILES:
        shutil.copyfile(os.path.join(bro_dir, n), os.path.join(LAST_GOOD, n + ".tmp"))
        os.replace(os.path.join(LAST_GOOD, n + ".tmp"), os.path.join(LAST_GOOD, n))


def read_broward(bro_dir, meta_dir=None):
    """Broward's rows from data/broward/ (its own dashboard, same tidy schema), or None if there are none. Returns new lists and
    changes nothing else.

    If data/broward/blend.json says Broward's dashboard is frozen and the state's page has a fresher Election Day count
    (blend_broward.py), that count replaces Broward's ElectionDay ballots and supplies Election Day's daily row. Those are the only
    two numbers the state's page can give; party, precinct and location detail are left exactly as collected."""
    meta_dir = meta_dir or bro_dir                       # blend.json and status.json always come from data/broward, even for the fallback copy
    if not os.path.exists(os.path.join(bro_dir, "summary.json")):
        return None
    summ = json.load(open(os.path.join(bro_dir, "summary.json")))

    def rd(fn):
        return list(csv.DictReader(open(os.path.join(bro_dir, fn))))
    out = {"by_type": [], "by_party": [], "by_precinct": [], "by_location": [], "loc_party": [], "by_date": [], "blended": 0}
    for r in rd("by_type.csv"):
        out["by_type"].append({"county": "BROWARD", "ballot_type": r["ballot_type"], "ballots": int(r["ballots"])})
    for r in rd("by_party.csv"):
        out["by_party"].append({"county": "BROWARD", "party_code": r["party_code"],
                                "party": PARTY.get(r["party_code"], r["party_code"]),
                                "mail": int(r["mail"]), "earlyvoting": int(r["earlyvoting"]),
                                "electionday": int(r["electionday"]),
                                "provisional": int(r["provisional"]), "total": int(r["total"])})
    for r in rd("by_precinct.csv"):
        out["by_precinct"].append({**r, "county": "BROWARD"})
    for r in rd("by_location.csv"):
        out["by_location"].append(r)
    for r in rd("location_party.csv"):
        lp = dict(r); lp["party"] = PARTY.get(r["party_code"], r["party_code"])
        out["loc_party"].append(lp)
    for r in rd("by_date.csv"):
        out["by_date"].append({**r, "county": "BROWARD"})
    try:
        blend = json.load(open(os.path.join(meta_dir, "blend.json")))
    except (OSError, ValueError):
        blend = None
    if blend and blend.get("active"):
        ed = int(blend["election_day"])
        row = next((r for r in out["by_type"] if r["ballot_type"] == "ElectionDay"), None)
        if row:
            row["ballots"] = max(row["ballots"], ed)
        else:
            out["by_type"].append({"county": "BROWARD", "ballot_type": "ElectionDay", "ballots": ed})
        day = next((r for r in out["by_date"] if r["date"] == blend["date"] and r["ballot_type"] == "All"), None)
        if day:
            day["ballots"] = max(int(day["ballots"]), ed)
        else:
            out["by_date"].append({"county": "BROWARD", "date": blend["date"], "ballot_type": "All", "ballots": ed})
        out["blended"] = ed
    try:
        status = json.load(open(os.path.join(meta_dir, "status.json")))
        stale, when = not status.get("ok", True), status.get("data_collected_at") or ""
    except (OSError, ValueError):
        stale, when = False, ""
    out["county"] = {
        "code": "BRO", "county": "BROWARD", "election": "2026 General Election",
        "election_date": "11/03/2026",
        "eligible_voters": summ["eligible_voters_allreg"],
        "last_updated": f"dashboard down: details carried over from {when[11:16]}" if stale else "live dashboard",
        "tabs": "Summary|Type|Party|Precinct|Location|Day",
        "precincts": summ["precincts"], "locations_ev": summ["ev_locations"],
        "locations_ed": summ["ed_locations"],
        "eligible_basis": "all registered",
    }
    return out


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

    # ---- merge Broward (its own dashboard, same tidy schema). Isolated: its rows are read into their own lists and only added if
    # everything read cleanly, so a problem in Broward's files can cost Broward its rows and never touch another county's.
    bro_dir, bro_failed = os.path.join(OUT, "broward"), False
    try:
        bro = read_broward(bro_dir)
        if bro:
            remember_good(bro_dir)
    except Exception as e:
        bro, bro_failed = None, True
        print(f"WARN: Broward's files could not be read ({type(e).__name__}: {str(e)[:120]}); falling back to its last complete set")
        try:
            bro = read_broward(LAST_GOOD, meta_dir=bro_dir)
        except Exception as e2:
            print(f"WARN: no usable last set either ({type(e2).__name__}: {str(e2)[:120]}); Broward is left out and the other 66 counties are unaffected")
    if bro:
        by_type += bro["by_type"]; by_party += bro["by_party"]; by_precinct += bro["by_precinct"]; by_location += bro["by_location"]
        loc_party += bro["loc_party"]; by_date += bro["by_date"]; counties.append(bro["county"])
        if bro["blended"]:
            print(f"Broward: Election Day count {bro['blended']:,} blended in from the state's page (its own dashboard is frozen)")
    elif not bro_failed:
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
