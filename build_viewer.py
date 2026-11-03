#!/usr/bin/env python3
"""Build the standalone turnout viewer: Reports/viewer.html.

Reads the tidy tables in data/ (written by normalize.py), the DOS book-closing workbooks in raw/,
and the county outlines in viewer/. Everything the page needs is embedded in the one HTML file,
so it opens by double-click, offline.

    .venv/bin/python build_viewer.py
"""
import base64, csv, glob, json, os, re, sys
from collections import defaultdict
from datetime import datetime, timezone
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
VIEW = os.path.join(HERE, "viewer")
OUT = os.path.join(HERE, "Reports", "viewer.html")
RUNS = os.path.join(HERE, "runs")           # archived turnout pulls (read only)
RESULTS = os.path.join(HERE, "results")     # election-night snapshots (read only)
PROJECTIONS = os.path.join(HERE, "projections")   # forecasts, markets and race calls (read only; never mixed into results)
sys.path.insert(0, VIEW)

TYPES = ("Mail", "EarlyVoting", "ElectionDay", "Provisional")
BROWARD = "BROWARD"

FIPS = {  # alphabetical, the Census numbering (Miami-Dade is 086)
    "ALACHUA": "12001", "BAKER": "12003", "BAY": "12005", "BRADFORD": "12007", "BREVARD": "12009",
    "BROWARD": "12011", "CALHOUN": "12013", "CHARLOTTE": "12015", "CITRUS": "12017", "CLAY": "12019",
    "COLLIER": "12021", "COLUMBIA": "12023", "DESOTO": "12027", "DIXIE": "12029", "DUVAL": "12031",
    "ESCAMBIA": "12033", "FLAGLER": "12035", "FRANKLIN": "12037", "GADSDEN": "12039", "GILCHRIST": "12041",
    "GLADES": "12043", "GULF": "12045", "HAMILTON": "12047", "HARDEE": "12049", "HENDRY": "12051",
    "HERNANDO": "12053", "HIGHLANDS": "12055", "HILLSBOROUGH": "12057", "HOLMES": "12059",
    "INDIAN RIVER": "12061", "JACKSON": "12063", "JEFFERSON": "12065", "LAFAYETTE": "12067", "LAKE": "12069",
    "LEE": "12071", "LEON": "12073", "LEVY": "12075", "LIBERTY": "12077", "MADISON": "12079",
    "MANATEE": "12081", "MARION": "12083", "MARTIN": "12085", "MIAMI-DADE": "12086", "MONROE": "12087",
    "NASSAU": "12089", "OKALOOSA": "12091", "OKEECHOBEE": "12093", "ORANGE": "12095", "OSCEOLA": "12097",
    "PALM BEACH": "12099", "PASCO": "12101", "PINELLAS": "12103", "POLK": "12105", "PUTNAM": "12107",
    "ST. JOHNS": "12109", "ST. LUCIE": "12111", "SANTA ROSA": "12113", "SARASOTA": "12115",
    "SEMINOLE": "12117", "SUMTER": "12119", "SUWANNEE": "12121", "TAYLOR": "12123", "UNION": "12125",
    "VOLUSIA": "12127", "WAKULLA": "12129", "WALTON": "12131", "WASHINGTON": "12133",
}
PARTY_COLS = {"REP": "Republican Party of Florida", "DEM": "Florida Democratic Party",
              "NPA": "No Party Affiliation"}
GROUPS = ("REP", "DEM", "NPA", "OTH")


def key(name):
    return str(name).strip().upper()


def pretty(name):
    return {"DESOTO": "DeSoto"}.get(key(name), key(name).title())


def rd(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def iso(mdy):
    """'10/19/2026' -> '2026-10-19'; '10/19' (Broward site table) -> '2026-10-19'."""
    parts = mdy.strip().split("/")
    if len(parts) == 2:
        parts.append("2026")
    return f"{int(parts[2]):04d}-{int(parts[0]):02d}-{int(parts[1]):02d}"


def to_int(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return 0


def parse_utc(s):
    """County feeds stamp times like 2026-11-03T00:50:01.4776483+00:00 (7 fractional digits)."""
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)?$", (s or "").strip())
    if not m:
        return None
    dt = datetime.fromisoformat(m.group(1) + (m.group(2) or "+00:00").replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc)


def load_dos_counties():
    """Active registered voters by county and party (book closing)."""
    ws = openpyxl.load_workbook(os.path.join(HERE, "raw", "1-party-by-county.xlsx"), data_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    hdr = [(h or "").strip() for h in rows[8]]
    out = {}
    for r in rows[9:]:
        if not r[0] or key(r[0]) == "TOTAL":
            continue
        out[key(r[0])] = {hdr[i]: (r[i] or 0) for i in range(1, len(hdr)) if hdr[i]}
    return out


def load_dos_precincts(county):
    """Active registered voters by precinct number, one county."""
    ws = openpyxl.load_workbook(os.path.join(HERE, "raw", "4-party-by-precinct-supplemental-with-minor-party.xlsx"),
                                data_only=True, read_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    hdr = [(h or "").strip() for h in rows[8]]
    col = hdr.index("TOTAL")
    return {str(r[1]).strip().upper(): int(r[col] or 0)
            for r in rows[9:] if r[0] and key(r[0]) == county}


def main():
    dos = load_dos_counties()
    counties_csv = rd(os.path.join(DATA, "counties.csv"))
    by_type = rd(os.path.join(DATA, "by_type.csv"))
    by_party = rd(os.path.join(DATA, "by_party.csv"))
    by_date = rd(os.path.join(DATA, "by_date.csv"))
    by_prec = rd(os.path.join(DATA, "by_precinct.csv"))
    by_loc = rd(os.path.join(DATA, "by_location.csv"))
    loc_party = rd(os.path.join(DATA, "location_party.csv"))
    loc_day = rd(os.path.join(DATA, "location_day.csv"))
    bro_ev = rd(os.path.join(DATA, "broward_ev_by_location.csv"))
    geo = json.load(open(os.path.join(VIEW, "fl_counties.json")))

    election = iso(counties_csv[0]["election_date"])

    # ---- counties, in alphabetical order (stable indexes for every other table)
    rows = sorted(counties_csv, key=lambda r: key(r["county"]))
    cidx = {key(r["county"]): i for i, r in enumerate(rows)}
    types = defaultdict(lambda: defaultdict(int))
    for r in by_type:
        types[key(r["county"])][r["ballot_type"]] += to_int(r["ballots"])

    party = defaultdict(lambda: {g: [0, 0, 0, 0, 0] for g in GROUPS})   # reg, ballots, mail, early, ed
    for r in by_party:
        g = r["party_code"] if r["party_code"] in PARTY_COLS else "OTH"
        p = party[key(r["county"])][g]
        p[1] += to_int(r["total"]); p[2] += to_int(r["mail"]); p[3] += to_int(r["earlyvoting"]); p[4] += to_int(r["electionday"])

    counties, stamps = [], []
    for r in rows:
        k = key(r["county"])
        d = dos[k]
        # Broward publishes against ALL registered voters; every other county, and the DOS book
        # closing, use ACTIVE registered. Use active everywhere so the rates compare.
        reg = d["TOTAL"] if k == BROWARD else to_int(r["eligible_voters"])
        for g in ("REP", "DEM", "NPA"):
            party[k][g][0] = to_int(d.get(PARTY_COLS[g]))
        party[k]["OTH"][0] = d["TOTAL"] - sum(party[k][g][0] for g in ("REP", "DEM", "NPA"))
        t = types[k]
        when = parse_utc(r["last_updated"])
        if when:
            stamps.append(when)
        counties.append({
            "id": r["code"], "name": pretty(r["county"]), "fips": FIPS[k], "reg": reg,
            "mail": t.get("Mail", 0), "early": t.get("EarlyVoting", 0), "ed": t.get("ElectionDay", 0),
            "prov": t.get("Provisional", 0),
            "total": sum(t.get(x, 0) for x in TYPES),
            "precincts": to_int(r["precincts"]), "evSites": to_int(r["locations_ev"]),
            "upd": when.strftime("%Y-%m-%dT%H:%M:%SZ") if when else None,
            "p": party[k],
        })

    # ---- daily ballots, county x date x [mail, early, election day, provisional]
    dates = sorted({iso(r["date"]) for r in by_date})
    didx = {d: i for i, d in enumerate(dates)}
    daily = [[[0, 0, 0, 0] for _ in dates] for _ in counties]
    slot = {"Mail": 0, "EarlyVoting": 1, "ElectionDay": 2, "Provisional": 3}
    bro_all = defaultdict(int)
    for r in by_date:
        k = key(r["county"]); n = to_int(r["ballots"])
        if r["ballot_type"] in slot:
            daily[cidx[k]][didx[iso(r["date"])]][slot[r["ballot_type"]]] += n
        elif k == BROWARD and r["ballot_type"] == "All":
            bro_all[iso(r["date"])] += n

    # Broward reports one "all ballots" number per day. Its early-voting-site table has the
    # in-person part, so mail = all - early. Before early voting opens, all of it is mail.
    ev_cols = [c for c in bro_ev[0] if re.fullmatch(r"\d\d/\d\d", c)] if bro_ev else []
    bro_ev_day = {iso(c): sum(to_int(r[c]) for r in bro_ev) for c in ev_cols}
    bro_ed_total = types[BROWARD].get("ElectionDay", 0)
    for d, a in bro_all.items():
        if BROWARD not in cidx:
            break
        e = bro_ev_day.get(d, 0)
        ed = min(a, bro_ed_total) if d == election else 0      # election day: everything not mail
        daily[cidx[BROWARD]][didx[d]] = [max(a - e - ed, 0), e, ed, 0]

    # ---- precincts (columnar). Broward's feed divides by ALL registered; rebase to DOS active.
    bro_active = load_dos_precincts(BROWARD)
    pc = {"c": [], "k": [], "r": [], "t": [], "m": [], "e": [], "d": []}
    rebased = missing = 0
    for r in by_prec:
        k = key(r["county"]); reg = to_int(r["eligible_voters"]); pk = r["precinct_key"].strip()
        if k == BROWARD:
            if pk.upper() in bro_active:
                reg = bro_active[pk.upper()]; rebased += 1
            else:
                missing += 1
        pc["c"].append(cidx[k]); pc["k"].append(pk); pc["r"].append(reg)
        pc["t"].append(to_int(r["total"])); pc["m"].append(to_int(r["mail"]))
        pc["e"].append(to_int(r["earlyvoting"])); pc["d"].append(to_int(r["electionday"]))

    # ---- early-voting sites: total, party mix, ballots per day
    ev_dates = sorted({iso(r["date"]) for r in loc_day if to_int(r["ballots"]) > 0} |
                      {d for d, n in bro_ev_day.items() if n > 0})
    evidx = {d: i for i, d in enumerate(ev_dates)}
    norm = lambda s: re.sub(r"\s+", " ", (s or "").strip().upper())
    sites = {}
    for r in by_loc:
        if r["kind"] != "Early Voting" or key(r["county"]) not in cidx:
            continue
        sites[(key(r["county"]), r["location_id"])] = {
            "c": cidx[key(r["county"])], "n": r["name"].strip(), "a": (r["address"] or "").strip(),
            "t": 0, "p": {g: 0 for g in GROUPS}, "d": [0] * len(ev_dates)}
    for r in loc_party:
        s = sites.get((key(r["county"]), r["location_id"]))
        if s:
            n = to_int(r["ballots"]); s["t"] += n
            s["p"][r["party_code"] if r["party_code"] in PARTY_COLS else "OTH"] += n
    for r in loc_day:
        s = sites.get((key(r["county"]), r["location_id"]))
        if s and iso(r["date"]) in evidx:
            s["d"][evidx[iso(r["date"])]] += to_int(r["ballots"])
    by_name = {norm(s["n"]): s for (k, _), s in sites.items() if k == BROWARD}
    unmatched = 0
    for r in bro_ev:
        n = norm(r["name"])
        # the two Broward tables sometimes differ by a suffix ("... BLDG" vs "... BLDG #3")
        s = by_name.get(n) or next((v for k, v in by_name.items() if k.startswith(n) or n.startswith(k)), None)
        if not s:
            unmatched += 1
            continue
        for c in ev_cols:
            if iso(c) in evidx:                                # a column of zeros is not in ev_dates
                s["d"][evidx[iso(c)]] = to_int(r[c])

    stamps.sort()
    meta = {
        "generated": datetime.now().astimezone().isoformat(timespec="seconds"),
        "feedLatest": stamps[-1].strftime("%Y-%m-%dT%H:%M:%SZ") if stamps else None,
        "feedOldest": stamps[0].strftime("%Y-%m-%dT%H:%M:%SZ") if stamps else None,
        "election": election,
        "broward": {"allRegistered": to_int(next((r["eligible_voters"] for r in counties_csv if key(r["county"]) == BROWARD), 0)),
                    "activeRegistered": dos.get(BROWARD, {}).get("TOTAL", 0)},
    }
    payload = {"meta": meta, "dates": dates, "evDates": ev_dates, "counties": counties, "daily": daily,
               "precincts": pc, "sites": sorted(sites.values(), key=lambda s: -s["t"]), "geo": geo}

    # ---- snapshots and results (AGENTS.md section 7): every archived turnout run and every results pull
    import snapshots as SN
    cidx_by_name = {SN.n2(c["name"]): i for i, c in enumerate(counties)}
    code_to_idx = {c["id"]: i for i, c in enumerate(counties)}
    payload["runs"] = SN.load_turnout_runs(RUNS, cidx, key) if os.path.isdir(RUNS) else []
    res = SN.load_results(RESULTS, cidx_by_name, code_to_idx) if os.path.isdir(RESULTS) else None
    if res and res["snaps"]:
        res["prec"] = SN.load_precincts(RESULTS, res["races"], code_to_idx)
        res["slow"] = SN.load_slow_index(RESULTS)
    payload["results"] = res if res and res["snaps"] else None
    proj = SN.load_projections(PROJECTIONS, (res or {}).get("races")) if os.path.isdir(PROJECTIONS) else None
    payload["projections"] = proj if proj and proj["snaps"] and proj["races"] else None
    try:                                                    # what the validators flagged (validation/, read only); a failure here only costs the page its checks card
        payload["checks"] = SN.load_checks(os.path.join(HERE, "validation"))
    except Exception as e:
        print(f"validation checks not loaded: {str(e)[:80]}")
        payload["checks"] = None

    # ---- reconcile before writing
    tot = lambda f: sum(c[f] for c in counties)
    dsum = lambda i: sum(x[i] for cd in daily for x in cd)
    print(f"counties {len(counties)}  registered {tot('reg'):,}  ballots {tot('total'):,}  "
          f"turnout {100 * tot('total') / tot('reg'):.2f}%")
    print(f"mail    by type {tot('mail'):>10,}   by day {dsum(0):>10,}")
    print(f"early   by type {tot('early'):>10,}   by day {dsum(1):>10,}")
    print(f"prov    by type {tot('prov'):>10,}   by day {dsum(3):>10,}")
    print(f"party-attributed ballots {sum(p[1] for c in counties for p in c['p'].values()):,}")
    print(f"Broward precincts rebased to active: {rebased} (no DOS match: {missing}); "
          f"daily mail derived {sum(x[0] for x in daily[cidx[BROWARD]]):,} vs reported {types[BROWARD].get('Mail', 0):,}")
    print(f"precincts {len(pc['c']):,}   sites {len(sites)} (Broward names unmatched: {unmatched})")
    print(f"turnout runs {len(payload['runs'])} ({sum(1 for r in payload['runs'] if r['d'])} with county detail)")
    if payload["projections"]:
        P = payload["projections"]
        print(f"projection snapshots {len(P['snaps'])}, forecast races {len(P['races'])} ({sum(1 for r in P['races'] if r['rid'])} matched to a results race)")
    if payload["results"]:
        R = payload["results"]
        print(f"results snapshots {len(R['snaps'])}, statewide races {len(R['races'])}, county contests {len(R['lraces'])}, "
              f"ENR counties {len(R['enr']['ci'])}, precinct counties {len((R.get('prec') or {}).get('counties', []))}")

    # ---- assemble the page
    def read(*p):
        with open(os.path.join(VIEW, *p), encoding="utf-8") as f:
            return f.read()

    def font(name, family, weights):
        b64 = base64.b64encode(open(os.path.join(VIEW, "fonts", name), "rb").read()).decode()
        return (f'@font-face{{font-family:"{family}";font-style:normal;font-weight:{weights};font-display:swap;'
                f'src:url(data:font/woff2;base64,{b64}) format("woff2")}}')

    fonts = font("fredoka-latin-wght-normal.woff2", "Fredoka", "300 700") + \
        font("nunito-latin-wght-normal.woff2", "Nunito", "200 1000")
    css = read("style.css")
    js = "\n".join(read("js", os.path.basename(p)) for p in sorted(glob.glob(os.path.join(VIEW, "js", "*.js"))))
    blob = json.dumps(payload, separators=(",", ":")).replace("</", "<\\/")
    html = (read("template.html")
            .replace("/*@FONTS*/", fonts).replace("/*@CSS*/", css)
            .replace("/*@DATA*/", "window.__DATA__=" + blob + ";").replace("/*@JS*/", js))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = f"{OUT}.{os.getpid()}.tmp"                                        # write then rename: never leave a half-written page
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(html)
    os.replace(tmp, OUT)
    print(f"WROTE {OUT}  ({os.path.getsize(OUT) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
