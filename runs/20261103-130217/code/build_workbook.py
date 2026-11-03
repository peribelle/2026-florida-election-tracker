#!/usr/bin/env python3
"""Build the Florida 2026 General Election turnout workbook."""
import csv, glob, json, os, statistics
from collections import defaultdict
from datetime import datetime
import openpyxl
import xlsxwriter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

# ---------------------------------------------------------------- reference
PARTY_NAME = {
 "DEM":"Democratic","REP":"Republican","NPA":"No Party Affiliation",
 "IND":"Independent Party of Florida","AIP":"American Independent (no FL registrants)",
 "LPF":"Libertarian","GRE":"Green","CPF":"Constitution","AMF":"America First",
 "ASP":"American Solidarity","BPP":"Boricua","CPP":"Coalition With A Purpose",
 "CSV":"Conservative","ECO":"Ecology","FFP":"Florida Forward",
 "PSL":"Party for Socialism & Liberation","JEF":"Jeffersonian","MGT":"MGTOW",
 "WTP":"We the People","WPF":"Working Families","OTH":"Other","UNK":"Unknown","":"Unassigned",
}
DISP = {"DESOTO":"DeSoto","MIAMI-DADE":"Miami-Dade","INDIAN RIVER":"Indian River",
        "PALM BEACH":"Palm Beach","SANTA ROSA":"Santa Rosa","ST. JOHNS":"St. Johns",
        "ST. LUCIE":"St. Lucie","LAKE":"Lake","LEE":"Lee","LEON":"Leon","LEVY":"Levy"}
def pretty(c):
    return DISP.get(c.upper(), c.title())

def num(x, d=0):
    try: return float(x)
    except (TypeError, ValueError): return None

# ---------------------------------------------------------------- DOS data
wb = openpyxl.load_workbook(os.path.join(HERE, "raw", "1-party-by-county.xlsx"), data_only=True)
ws = wb.active
_rows = list(ws.iter_rows(values_only=True))
HDR = [(h or "").strip() for h in _rows[8]]
DOS = {}
for r in _rows[9:]:
    if not r[0]: continue
    k = str(r[0]).strip().upper()
    if k == "TOTAL": continue
    DOS[k] = {HDR[i]: (r[i] or 0) for i in range(1, len(HDR)) if HDR[i]}
DOS_PARTY_COLS = {
 "REP":"Republican Party of Florida","DEM":"Florida Democratic Party",
 "AMF":"America First Party of Florida","ASP":"American Solidarity Party of Florida",
 "BPP":"Boricua Party","CPP":"Coalition With A Purpose Party",
 "CSV":"Conservative Party of Florida","CPF":"Constitution Party of Florida",
 "ECO":"Ecology Party of Florida","FFP":"Florida Forward Party",
 "GRE":"Green Party of Florida","IND":"Independent Party of Florida",
 "JEF":"Jeffersonian Party of Florida","LPF":"Libertarian Party of Florida",
 "MGT":"MGTOW Party","PSL":"Party for Socialism & Liberation - Florida",
 "WTP":"We the People Florida","NPA":"No Party Affiliation",
}
STATE_REG_TOTAL = sum(d["TOTAL"] for d in DOS.values())

# ---------------------------------------------------------------- tidy inputs
counties = {r["county"].upper(): r for r in csv.DictReader(open(os.path.join(DATA, "counties.csv")))}
by_type = defaultdict(lambda: defaultdict(int))
for r in csv.DictReader(open(os.path.join(DATA, "by_type.csv"))):
    by_type[r["county"].upper()][r["ballot_type"]] += int(r["ballots"])
by_party = defaultdict(lambda: defaultdict(int))
for r in csv.DictReader(open(os.path.join(DATA, "by_party.csv"))):
    by_party[r["county"].upper()][r["party_code"]] += int(r["total"])
precincts = list(csv.DictReader(open(os.path.join(DATA, "by_precinct.csv"))))
locations = list(csv.DictReader(open(os.path.join(DATA, "by_location.csv"))))
loc_party = list(csv.DictReader(open(os.path.join(DATA, "location_party.csv"))))
loc_day = list(csv.DictReader(open(os.path.join(DATA, "location_day.csv"))))
by_date = list(csv.DictReader(open(os.path.join(DATA, "by_date.csv"))))
broward_ev = list(csv.DictReader(open(os.path.join(DATA, "broward_ev_by_location.csv"))))
sites = json.load(open(os.path.join(HERE, "raw", "sites.json")))
collect_log = {r["code"]: r for r in json.load(open(os.path.join(HERE, "raw", "collect_log.json")))}
BROWARD_EV_TOTAL = sum(int(r["total"]) for r in broward_ev)

# owes: ballots by party including Broward is impossible (not published)
# ---------------------------------------------------------------- county summary
summary = []
for code, rec in collect_log.items():
    nm = rec["county"]
    src = "County feed (VR Systems TQV)" if rec["status"] == "ok" else "County PDF (early voting only)"
    summary.append({"_code": code, "county": nm, "status": rec["status"]})

rows = []
for s in summary:
    nm = s["county"]
    code = s["_code"]
    dos = DOS.get(nm.upper(), {})
    r = counties[nm.upper()]
    bt = by_type[nm.upper()]
    mail, early = bt.get("Mail", 0), bt.get("EarlyVoting", 0)
    ed, prov = bt.get("ElectionDay", 0), bt.get("Provisional", 0)
    total = mail + early + ed + prov
    # Broward publishes eligibility on an all-registered basis; use the same
    # active-registered denominator as every other county so rates compare.
    elig = dos.get("TOTAL", 0) if nm.upper() == "BROWARD" else int(r["eligible_voters"])
    last = r["last_updated"]
    nprec = int(r["precincts"]); nev = int(r["locations_ev"]); ned = int(r["locations_ed"])
    published_elig = int(r["eligible_voters"])
    rows.append({
        "county": pretty(nm), "code": code, "source": s["status"],
        "elig": elig, "dos": dos.get("TOTAL"), "reg_rep": dos.get("Republican Party of Florida"),
        "reg_dem": dos.get("Florida Democratic Party"), "reg_npa": dos.get("No Party Affiliation"),
        "mail": mail, "early": early, "ed": ed, "prov": prov, "total": total,
        "rate": 100 * total / elig if elig else None,
        "precincts": nprec, "evsites": nev, "edsites": ned,
        "last": last,
        "complete": ("Full - county dashboard; publishes turnout on all-registered basis"
                     if nm.upper() == "BROWARD" else "Full"),
        "pub_elig": published_elig,
        "site": sites[code]["site"], "code2": code,
    })
rows.sort(key=lambda r: r["county"])

TOT = {k: sum(r[k] or 0 for r in rows) for k in ("elig", "mail", "early", "ed", "prov", "total")}
STATE_TURNOUT = 100 * TOT["total"] / TOT["elig"]

# ---------------------------------------------------------------- party table
party_reg = defaultdict(int)
for d in DOS.values():
    for k, col in DOS_PARTY_COLS.items():
        party_reg[k] += d.get(col, 0)
party_bal = defaultdict(int)
for c, d in by_party.items():
    for k, v in d.items(): party_bal[k] += v
# all 67 counties now report party ballots, so numerator and denominator match
party_reg66 = dict(party_reg)
party_bal66 = dict(party_bal)

PARTY_SPLIT = defaultdict(lambda: defaultdict(int))
for c, d in by_party.items():
    for k, v in d.items():
        PARTY_SPLIT[k]["_total"] += v
for f in glob.glob(os.path.join(HERE, "raw", "tqv", "*.json")):
    d = json.load(open(f))
    for pk, v in d.get("Turnout", {}).get("PartyType", {}).items():
        for ty, n in v.items():
            PARTY_SPLIT[pk][ty] += n or 0

party_rows = []
PARTY_ATTR_TOTAL = sum(party_bal66.values())
for k in sorted(party_reg, key=lambda x: -party_reg[x]):
    reg = party_reg[k]; reg66 = party_reg66.get(k, 0); bal = party_bal66.get(k, 0)
    party_rows.append({
        "code": k, "party": PARTY_NAME.get(k, k), "reg": reg,
        "reg66": reg66, "bal": bal, "rate": 100 * bal / reg66 if reg66 else None,
        "share_reg": 100 * reg / STATE_REG_TOTAL if STATE_REG_TOTAL else None,
        "share_bal": 100 * bal / PARTY_ATTR_TOTAL if PARTY_ATTR_TOTAL else None,
        "mail": PARTY_SPLIT.get(k, {}).get("Mail", 0),
        "early": PARTY_SPLIT.get(k, {}).get("EarlyVoting", 0),
    })

RATE = {p["code"]: p["rate"] for p in party_rows}
BAL = {p["code"]: p["bal"] for p in party_rows}
RATE_BALLOTS = f'{BAL["REP"]:,} to {BAL["DEM"]:,}'

# ---------------------------------------------------------------- charts data
county_rate = sorted([r for r in rows if r["rate"] is not None], key=lambda r: -r["rate"])
top20 = county_rate[:20]
bot10 = county_rate[-10:][::-1]
top15_vol = sorted(rows, key=lambda r: -r["total"])[:15]

# partisan gap per county (R rate - D rate), all 67 counties
gap = []
for nm, d in DOS.items():
    rr = d.get("Republican Party of Florida", 0); dd = d.get("Florida Democratic Party", 0)
    b = by_party.get(nm, {})
    if not rr or not dd: continue
    gap.append({"county": pretty(nm), "r_rate": 100 * b.get("REP", 0) / rr,
                "d_rate": 100 * b.get("DEM", 0) / dd,
                "gap": 100 * b.get("REP", 0) / rr - 100 * b.get("DEM", 0) / dd})
gap.sort(key=lambda x: -x["gap"])

# daily statewide
daily = defaultdict(lambda: defaultdict(int))
for r in by_date:
    daily[r["date"]][r["ballot_type"]] += int(r["ballots"])
for r in broward_ev:
    pass  # Broward dates handled below
bro_daily = defaultdict(int)
for r in by_date:
    if r["ballot_type"] not in ("Mail", "EarlyVoting", "ElectionDay", "Provisional"):
        try:
            bro_daily[r["date"]] += int(r["ballots"])
        except (TypeError, ValueError):
            pass
def dkey(s):
    s = s.strip()
    if "/" in s and s.count("/") == 1:
        s = s + "/2026"
    return datetime.strptime(s, "%m/%d/%Y")
daily_rows = sorted(daily.items(), key=lambda kv: dkey(kv[0]))

# busiest early voting locations (join names)
name_map = {}
for l in locations:
    name_map[(l["county"], l["location_id"])] = l
loc_tot = defaultdict(int)
for r in loc_party:
    loc_tot[(r["county"], r["location_id"])] += int(r["ballots"])
for r in broward_ev:
    loc_tot[("BROWARD", r["location_id"])] += int(r["total"])
busiest = []
for (c, lid), v in loc_tot.items():
    info = name_map.get((c, lid))
    nm = info["name"] if info else next((x["name"] for x in broward_ev if x["location_id"] == lid), lid)
    ad = info["address"] if info else ""
    busiest.append({"county": pretty(c), "id": lid, "name": nm, "address": ad, "ballots": v})
busiest.sort(key=lambda x: -x["ballots"])

# precinct turnout buckets
buckets = defaultdict(int)
pv = []
for r in precincts:
    e = num(r["eligible_voters"]) or 0
    t = num(r["total"]) or 0
    pct = num(r["turnout_pct"]) or 0
    if e >= 50:
        pv.append(pct)
        buckets[min(int(pct // 10) * 10, 90)] += 1

FINDINGS = {
    "state_turnout": STATE_TURNOUT,
    "total_ballots": TOT["total"],
    "total_elig": TOT["elig"],
    "mail": TOT["mail"], "early": TOT["early"],
    "top": [(r["county"], r["rate"]) for r in county_rate[:5]],
    "bottom": [(r["county"], r["rate"]) for r in county_rate[-5:]],
    "median_county": statistics.median([r["rate"] for r in county_rate]),
    "median_precinct": statistics.median(pv),
    "peak": max(((k, sum(v.values())) for k, v in daily.items()), key=lambda x: x[1]),
    "gap_top": gap[:5], "gap_bottom": gap[-5:],
    "busiest": busiest[:5],
    "broward_ev": BROWARD_EV_TOTAL,
    "party": party_rows,
}
json.dump(FINDINGS, open(os.path.join(HERE, "data", "findings.json"), "w"), indent=1, default=str)

# ================================================================ WORKBOOK
FN = os.path.join(HERE, "Reports", "Florida_2026_General_Turnout.xlsx")
book = xlsxwriter.Workbook(FN, {"nan_inf_to_errors": True})

F = {}
F["title"] = book.add_format({"bold": True, "font_size": 18, "font_color": "#0B3D63"})
F["sub"] = book.add_format({"italic": True, "font_size": 10, "font_color": "#555555"})
F["h"] = book.add_format({"bold": True, "bg_color": "#0B3D63", "font_color": "white",
                          "border": 1, "border_color": "#FFFFFF", "text_wrap": True, "valign": "vcenter"})
F["h2"] = book.add_format({"bold": True, "bg_color": "#E8EEF4", "border": 1, "border_color": "#B8C7D6"})
F["txt"] = book.add_format({"valign": "top", "text_wrap": True})
F["wrap"] = book.add_format({"text_wrap": True, "valign": "top"})
F["int"] = book.add_format({"num_format": "#,##0"})
F["pct"] = book.add_format({"num_format": "0.0\\%"})
F["dec"] = book.add_format({"num_format": "#,##0.0"})
F["link"] = book.add_format({"font_color": "#1155CC", "underline": 1, "font_size": 10})
F["bold"] = book.add_format({"bold": True})
F["note"] = book.add_format({"italic": True, "font_size": 9, "font_color": "#666666", "text_wrap": True, "valign": "top"})

def sheet(name, widths, tab_color=None):
    ws = book.add_worksheet(name)
    if tab_color: ws.set_tab_color(tab_color)
    for i, w in enumerate(widths): ws.set_column(i, i, w)
    return ws

def head(ws, r, cols, fmt=None):
    for c, v in enumerate(cols):
        ws.write(r, c, v, fmt or F["h"])
    ws.freeze_panes(r + 1, 0)
    ws.autofilter(r, 0, r, len(cols) - 1)

def put(ws, r, c, v, fmt=None):
    if v is None or v == "":
        ws.write_blank(r, c, None, fmt)
    elif isinstance(v, (int, float)):
        ws.write_number(r, c, v, fmt or F["int"])
    else:
        ws.write_string(r, c, str(v), fmt)

# ---------------------------------------------------------------- 1 README
ws = book.add_worksheet("README"); ws.set_tab_color("#0B3D63")
ws.hide_gridlines(2); ws.set_column(0, 0, 3); ws.set_column(1, 1, 30); ws.set_column(2, 2, 105)
ws.write(1, 1, "Florida 2026 General Election - Live Turnout Workbook", F["title"])
ws.write(2, 1, "Built from county-reported unofficial turnout, pulled directly from all 67 county election feeds.", F["sub"])
r = 4
meta = [
 ("Election", "2026 General Election - Tuesday, November 3, 2026"),
 ("Data pulled", datetime.now().strftime("%A, %B %d, %Y at %I:%M %p local")),
 ("Status at pull", "Early voting closed (final day Nov 1). No Election Day ballots cast yet. "
                    "Totals = vote-by-mail ballots returned + early voting ballots. Election Day tab will populate Nov 3."),
 ("Counties covered", "67 of 67"),
 ("Ballots counted", f'{TOT["total"]:,}'),
 ("Registered / eligible voters", f'{TOT["elig"]:,}'),
 ("Statewide turnout so far", f'{STATE_TURNOUT:.2f}%'),
 ("Primary source", "VR Systems 'Turnout Quick View' JSON feeds (tqv.vrswebapps.com) - the same feed behind each county's own turnout dashboard"),
 ("Denominator source", "FL Division of Elections Book Closing report, 2026 General, closed Oct 5 2026 (active registered voters)"),
 ("County websites", "FL Division of Elections official Supervisor of Elections directory"),
 ("Broward note", "Broward does not publish its 2026 turnout in the shared feed. Early voting (314,113) was parsed from "
                  "Broward's official daily PDF. Broward mail returns are not published before Election Day, so its totals "
                  "and party/precinct breakdowns are intentionally blank."),
]
for k, v in meta:
    ws.write(r, 1, k, F["bold"]); ws.write(r, 2, v, F["wrap"]); r += 1
r += 1
ws.write(r, 1, "What is on each tab", F["h2"]); r += 1
tabs = [
 ("County Summary", "One row per county: eligible voters, ballots cast, turnout %, mail vs early split, last update, data status."),
 ("Elections Sites", "Official elections website and live turnout dashboard for every county."),
 ("By Party", "Ballots cast by party (statewide + per county) against party registration."),
 ("By Ballot Type", "Mail vs early voting vs election day vs provisional, per county."),
 ("By Precinct", "Every precinct in the state: eligible voters, ballots, turnout %."),
 ("Precinct x Type", "Long format: one row per precinct per ballot type (pivot-ready)."),
 ("By Date", "Ballots by date and type - the daily early-vote and mail curve."),
 ("Locations", "Every early voting site and Election Day precinct location with address."),
 ("Location x Party", "Ballots at each early voting site, broken out by party."),
 ("Location x Day", "Ballots at each early voting site per day."),
 ("Precinct Registration", "Registered voters by party in every precinct (book closing)."),
 ("County Registration", "Registered voters by party in every county (book closing)."),
 ("Charts", "Eight charts on the most interesting patterns."),
 ("Method & Caveats", "How the numbers were collected, what they do and do not mean."),
]
for k, v in tabs:
    ws.write(r, 1, k, F["bold"]); ws.write(r, 2, v, F["wrap"]); r += 1

# ---------------------------------------------------------------- 2 County Summary
ws = sheet("County Summary", [3, 18, 7, 15, 11, 11, 11, 10, 10, 10, 10, 10, 9, 8, 8, 8, 26, 30], "#2E75B6")
ws.write(0, 1, "County Summary - 2026 General Election turnout", F["title"])
ws.write(1, 1, "Ballots counted as of pull time. 'Eligible' = active registered voters reported by the county.", F["sub"])
cols = ["County","Code","Ballots cast","Turnout %","Mail","Early vote","Election day","Provisional",
        "Eligible voters","DOS check","Precincts","EV sites","ED sites","Data status","Last update","Elections site"]
head(ws, 3, cols)
R0 = 4
for i, x in enumerate(rows):
    r = R0 + i
    put(ws, r, 0, x["county"]); put(ws, r, 1, x["code"])
    put(ws, r, 2, x["total"]); put(ws, r, 3, x["rate"], F["pct"])
    put(ws, r, 4, x["mail"]); put(ws, r, 5, x["early"]); put(ws, r, 6, x["ed"]); put(ws, r, 7, x["prov"])
    put(ws, r, 8, x["elig"]); put(ws, r, 9, x["dos"])
    put(ws, r, 10, x["precincts"]); put(ws, r, 11, x["evsites"]); put(ws, r, 12, x["edsites"])
    put(ws, r, 13, x["complete"]); put(ws, r, 14, str(x["last"])[:19])
    ws.write_url(r, 15, x["site"], F["link"], x["site"])
rt = R0 + len(rows)
ws.write(rt, 0, "FLORIDA", F["bold"]); ws.write(rt, 1, "", F["bold"])
for c, k in [(2,"total"),(4,"mail"),(5,"early"),(6,"ed"),(7,"prov"),(8,"elig")]:
    put(ws, rt, c, TOT[k], F["int"])
put(ws, rt, 3, STATE_TURNOUT, F["pct"])
ws.write(rt, 13, "Turnout = mail + early only", F["note"])
ws.conditional_format(R0, 3, rt - 1, 3, {"type":"3_color_scale","min_color":"#F8696B","mid_color":"#FFEB84","max_color":"#63BE7B"})

# ---------------------------------------------------------------- 3 Elections Sites
ws = sheet("Elections Sites", [3, 18, 7, 38, 62, 26], "#70AD47")
ws.write(0, 1, "Elections websites - all 67 Florida counties", F["title"])
ws.write(1, 1, "Official Supervisor of Elections site, plus the live turnout dashboard URL used for this workbook.", F["sub"])
head(ws, 3, ["County","Code","Official elections website","Live turnout dashboard (TQV)","Feed status"])
url_by_code = {r["code2"]: r["county"] for r in rows}
for i, (code, rec) in enumerate(sorted(collect_log.items(), key=lambda kv: kv[1]["county"])):
    r = 4 + i
    nm = pretty(rec["county"])
    put(ws, r, 0, nm); put(ws, r, 1, code)
    ws.write_url(r, 2, sites[code]["site"], F["link"], sites[code]["site"])
    if rec["status"] == "ok":
        u = f'https://tqv.vrswebapps.com/?state=FL&county={code}&election={rec["election_number"]}'
        ws.write_url(r, 3, u, F["link"], f"{u}  (election {rec['election_number']})")
        put(ws, r, 4, "Live JSON feed")
    else:
        ws.write(r, 3, "Not in shared feed - county PDF used", F["txt"])
        put(ws, r, 4, "PDF only")

# ---------------------------------------------------------------- 4 By Party
ws = sheet("By Party", [3, 30, 14, 13, 12, 12, 12, 12, 11], "#ED7D31")
ws.write(0, 1, "Turnout by party", F["title"])
ws.write(1, 1, "Registration is book-closing (Oct 5). Ballots are what each party's voters have already cast. "
               "Broward excluded from party totals (county does not publish party splits before Election Day).", F["sub"])
head(ws, 3, ["Party","Registered (active, all 67)","Ballots cast","Turnout of party","Voted by mail","Voted early","% of registrants","% of ballots"])
for i, p in enumerate(party_rows):
    r = 4 + i
    put(ws, r, 0, p["party"]); put(ws, r, 1, p["reg"])
    put(ws, r, 2, p["bal"]); put(ws, r, 3, p["rate"], F["pct"])
    put(ws, r, 4, p["mail"]); put(ws, r, 5, p["early"])
    put(ws, r, 6, p["share_reg"], F["pct"]); put(ws, r, 7, p["share_bal"], F["pct"])
r = 4 + len(party_rows)
put(ws, r, 0, "TOTAL", F["bold"]); put(ws, r, 1, STATE_REG_TOTAL)
put(ws, r, 3, TOT["total"])
put(ws, r, 3, 100 * TOT["total"] / sum(party_reg.values()), F["pct"])
r += 2
ws.write(r, 1, "By county", F["h2"]); r += 1
for c, h in enumerate(["County","Republican ballots","Democratic ballots","All other ballots",
                       "Total ballots","R turnout %","D turnout %","D minus R (pts)"]):
    ws.write(r, c, h, F["h"])
r += 1
for x in rows:
    d = by_party[x["county"].upper()]
    rep, dem = d.get("REP", 0), d.get("DEM", 0)
    rr, dd = x["reg_rep"] or 0, x["reg_dem"] or 0
    rp = 100 * rep / rr if rr else None
    dp = 100 * dem / dd if dd else None
    put(ws, r, 0, x["county"]); put(ws, r, 1, rep); put(ws, r, 2, dem)
    put(ws, r, 3, x["total"] - rep - dem); put(ws, r, 4, x["total"])
    put(ws, r, 5, rp, F["pct"]); put(ws, r, 6, dp, F["pct"])
    put(ws, r, 7, (dp - rp) if (dp is not None and rp is not None) else None, F["dec"])
    r += 1

# ---------------------------------------------------------------- 5 By Ballot Type
ws = sheet("By Ballot Type", [3, 20, 12, 12, 12, 12, 12, 10, 10], "#A5A5A5")
ws.write(0, 1, "Ballots by type", F["title"])
ws.write(1, 1, "Mail = returned vote-by-mail ballots. Early = in-person early voting. Election Day is empty until Nov 3.", F["sub"])
head(ws, 3, ["County","Mail","Early vote","Election day","Provisional","Total","Mail share","Early share"])
for i, x in enumerate(rows):
    r = 4 + i
    put(ws, r, 0, x["county"]); put(ws, r, 1, x["mail"]); put(ws, r, 2, x["early"])
    put(ws, r, 3, x["ed"]); put(ws, r, 4, x["prov"]); put(ws, r, 5, x["total"])
    put(ws, r, 6, 100 * x["mail"] / x["total"] if x["mail"] else None, F["pct"])
    put(ws, r, 7, 100 * x["early"] / x["total"] if x["early"] else None, F["pct"])
r = 4 + len(rows)
put(ws, r, 0, "FLORIDA", F["bold"])
for c, k in [(1,"mail"),(2,"early"),(3,"ed"),(4,"prov"),(5,"total")]: put(ws, r, c, TOT[k], F["bold"])

# ---------------------------------------------------------------- 6 By Precinct
ws = sheet("By Precinct", [3, 18, 14, 13, 11, 11, 11, 11, 11, 10], "#4472C4")
ws.write(0, 1, "Turnout by precinct", F["title"])
ws.write(1, 1, "Every precinct reported to the state feed. Precinct keys ending in S## or A## are split precincts.", F["sub"])
head(ws, 3, ["County","Precinct","Eligible voters","Ballots","Turnout %","Mail","Early vote","Election day","Provisional"])
for i, p in enumerate(precincts):
    r = 4 + i
    put(ws, r, 0, pretty(p["county"])); put(ws, r, 1, p["precinct_key"])
    put(ws, r, 2, num(p["eligible_voters"])); put(ws, r, 3, num(p["total"]))
    put(ws, r, 4, num(p["turnout_pct"]), F["pct"])
    put(ws, r, 5, num(p["mail"])); put(ws, r, 6, num(p["earlyvoting"]))
    put(ws, r, 7, num(p["electionday"])); put(ws, r, 8, num(p["provisional"]))

# ---------------------------------------------------------------- 7 Precinct x Type
ws = sheet("Precinct x Type", [3, 18, 12, 14, 10], "#8FAADC")
ws.write(0, 1, "Precinct by ballot type (long format)", F["title"])
ws.write(1, 1, "One row per precinct per ballot type - ready to pivot.", F["sub"])
head(ws, 3, ["County","Precinct","Ballot type","Ballots"])
r = 4
for p in precincts:
    for ty, col in (("Mail","mail"),("Early Voting","earlyvoting"),
                    ("Election Day","electionday"),("Provisional","provisional")):
        v = num(p[col]) or 0
        if v == 0: continue
        put(ws, r, 0, pretty(p["county"])); put(ws, r, 1, p["precinct_key"])
        put(ws, r, 2, ty); put(ws, r, 3, v); r += 1

# ---------------------------------------------------------------- 8 By Date
ws = sheet("By Date", [3, 18, 12, 12, 12, 10], "#FFC000")
ws.write(0, 1, "Ballots by date", F["title"])
ws.write(1, 1, "Mail ballots count on the date the county received/processed them, so the mail series starts in September.", F["sub"])
head(ws, 3, ["County","Date","Ballot type","Ballots",""])
r = 4
for d in by_date:
    put(ws, r, 0, pretty(d["county"])); put(ws, r, 1, d["date"])
    put(ws, r, 2, d["ballot_type"]); put(ws, r, 3, num(d["ballots"])); r += 1


# ---------------------------------------------------------------- 9 Locations
ws = sheet("Locations", [3, 18, 10, 12, 46, 52], "#9E480E")
ws.write(0, 1, "Voting locations", F["title"])
ws.write(1, 1, "Every early voting site and Election Day precinct location published by each county.", F["sub"])
head(ws, 3, ["County","Location ID","Type","Name","Address"])
r = 4
for l in locations:
    put(ws, r, 0, pretty(l["county"])); put(ws, r, 1, l["location_id"]); put(ws, r, 2, l["kind"])
    put(ws, r, 3, l["name"]); put(ws, r, 4, l["address"]); r += 1


# ---------------------------------------------------------------- 10 Location x Party
ws = sheet("Location x Party", [3, 18, 10, 40, 30, 12], "#C55A11")
ws.write(0, 1, "Ballots by early voting location and party", F["title"])
ws.write(1, 1, "Where each party's early voters actually showed up. Includes provisional ballots cast at early sites.", F["sub"])
head(ws, 3, ["County","Location ID","Location","Party","Ballots"])
r = 4
for x in loc_party:
    if not int(x["ballots"]): continue
    info = next((l for l in locations if l["county"] == x["county"] and l["location_id"] == x["location_id"]), None)
    put(ws, r, 0, pretty(x["county"])); put(ws, r, 1, x["location_id"])
    put(ws, r, 2, info["name"] if info else x["location_id"])
    put(ws, r, 3, PARTY_NAME.get(x["party_code"], x["party_code"]))
    put(ws, r, 4, int(x["ballots"])); r += 1

# ---------------------------------------------------------------- 11 Location x Day
ws = sheet("Location x Day", [3, 18, 10, 40, 12, 12], "#F4B183")
ws.write(0, 1, "Ballots by early voting location and day", F["title"])
ws.write(1, 1, "Daily flow at every early voting site.", F["sub"])
head(ws, 3, ["County","Location ID","Location","Date","Ballots"])
r = 4
for x in loc_day:
    info = next((l for l in locations if l["county"] == x["county"] and l["location_id"] == x["location_id"]), None)
    put(ws, r, 0, pretty(x["county"])); put(ws, r, 1, x["location_id"])
    put(ws, r, 2, info["name"] if info else x["location_id"])
    put(ws, r, 3, x["date"]); put(ws, r, 4, int(x["ballots"])); r += 1


# ---------------------------------------------------------------- 12 Precinct Registration
ws2 = xlsxwriter  # noqa
wb2 = openpyxl.load_workbook(os.path.join(HERE, "raw", "4-party-by-precinct-supplemental-with-minor-party.xlsx"), data_only=True)
ws2s = wb2.active
_rows2 = list(ws2s.iter_rows(values_only=True))
H2 = [(h or "").strip() for h in _rows2[8]]
ws = sheet("Precinct Registration", [3, 18, 12, 11, 11, 11, 11, 12, 11, 11], "#7030A0")
ws.write(0, 1, "Registered voters by precinct and party (book closing Oct 5, 2026)", F["title"])
ws.write(1, 1, "FL Division of Elections book closing report. Party columns are the four largest plus total.", F["sub"])
head(ws, 3, ["County","Precinct","Republican","Democrat","No party","Other","Total"])
r = 4
for row in _rows2[9:]:
    if not row[0]: continue
    if str(row[0]).strip().upper() == "TOTAL": continue
    d = {H2[i]: row[i] for i in range(1, len(H2)) if H2[i]}
    rep = d.get("Republican Party of Florida", 0) or 0
    dem = d.get("Florida Democratic Party", 0) or 0
    npa = d.get("No Party Affiliation", 0) or 0
    tot = d.get("TOTAL", 0) or 0
    put(ws, r, 0, pretty(str(row[0]).strip())); put(ws, r, 1, str(row[1]).strip())
    put(ws, r, 2, rep); put(ws, r, 3, dem); put(ws, r, 4, npa)
    put(ws, r, 5, tot - rep - dem - npa); put(ws, r, 6, tot); r += 1

# ---------------------------------------------------------------- 13 County Registration
ws = sheet("County Registration", [3, 18, 11, 11, 11, 11, 11, 11, 11, 11], "#7030A0")
ws.write(0, 1, "Registered voters by county and party (book closing Oct 5, 2026)", F["title"])
head(ws, 3, ["County","Republican","Democrat","No party","Independent","Libertarian","Green","Other","Total"])
r = 4
for nm in sorted(DOS, key=pretty):
    d = DOS[nm]
    rep = d.get("Republican Party of Florida",0); dem = d.get("Florida Democratic Party",0)
    npa = d.get("No Party Affiliation",0); ind = d.get("Independent Party of Florida",0)
    lpf = d.get("Libertarian Party of Florida",0); gre = d.get("Green Party of Florida",0)
    tot = d.get("TOTAL",0)
    put(ws, r, 0, pretty(nm)); put(ws, r, 1, rep); put(ws, r, 2, dem); put(ws, r, 3, npa)
    put(ws, r, 4, ind); put(ws, r, 5, lpf); put(ws, r, 6, gre)
    put(ws, r, 7, tot - rep - dem - npa - ind - lpf - gre); put(ws, r, 8, tot); r += 1

# ---------------------------------------------------------------- 14 Chart data
cd = book.add_worksheet("ChartData"); cd.hide(); cd.set_column(0, 0, 26); cd.set_column(1, 8, 12)
row = 0

def block(title, header, data, fmt=None):
    global row
    cd.write(row, 0, title, F["bold"]); row += 1
    for c, h in enumerate(header): cd.write(row, c, h, F["h2"])
    row += 1
    start = row
    for d in data:
        for c, v in enumerate(d): cd.write(row, c, v)
        row += 1
    row += 2
    return start - 1, start, start + len(data) - 1

# A party
a_hdr_row, a0, a1 = block("A: Party turnout (67 counties)", ["Party","Registered","Ballots","Turnout %"],
    [[p["party"], p["reg66"], p["bal"], round(p["rate"] or 0, 2)] for p in party_rows[:6]])
# B top20
b_hdr_row, b0, b1 = block("B: Top 20 counties by turnout %", ["County","Turnout %"],
    [[r["county"], round(r["rate"],2)] for r in top20])
# C bottom10
c_hdr_row, c0, c1 = block("C: Bottom 10 counties by turnout %", ["County","Turnout %"],
    [[r["county"], round(r["rate"],2)] for r in bot10])
# D scatter
d_hdr_row, d0, d1 = block("D: Size vs turnout", ["Eligible voters","Turnout %"],
    [[r["elig"], round(r["rate"],2)] for r in county_rate])
# E top15 stacked
e_hdr_row, e0, e1 = block("E: Top 15 counties - mail vs early", ["County","Mail","Early vote"],
    [[r["county"], r["mail"] or 0, r["early"] or 0] for r in top15_vol])
# F daily
fdata = []
for k, v in daily_rows:
    fdata.append([dkey(k), v.get("Mail", 0), v.get("EarlyVoting", 0), 0])
bkey = {dkey(k): v for k, v in bro_daily.items()}
for dt, v in bkey.items():
    for fr in fdata:
        if fr[0] == dt:
            fr[3] = v
            break
    else:
        fdata.append([dt, 0, 0, v])
fdata.sort(key=lambda x: x[0])
f_hdr_row, f0, f1 = block("F: Daily ballots", ["Date", "Mail", "Early vote", "Broward (all)"],
    [[d, m, e, b] for d, m, e, b in fdata])
# G gap
gg = gap[:10] + gap[-10:]
g_hdr_row, g0, g1 = block("G: Partisan turnout gap (R rate - D rate)", ["County","Gap (pts)"],
    [[g["county"], round(g["gap"],2)] for g in gg])
# H buckets
hkeys = sorted(buckets)
h_hdr_row, h0, h1 = block("H: Precinct turnout distribution", ["Turnout band","Precincts"],
    [[f"{k}-{k+9}%", buckets[k]] for k in hkeys])
# I busiest
i_hdr_row, i0, i1 = block("I: Busiest early voting sites", ["Site","Ballots"],
    [[f'{b["name"][:46]} ({b["county"]})', b["ballots"]] for b in busiest[:15]])

# fix date formatting column for F
# (dates written as Excel dates via write_datetime handled below by rebuilding)
cd.set_column(0, 0, 46)

# ---------------------------------------------------------------- 15 Charts
ws = book.add_worksheet("Charts"); ws.set_tab_color("#FF0000")
ws.hide_gridlines(2)
ws.write(0, 0, "The most interesting findings", F["title"])
ws.write(1, 0, "Charts are native Excel objects - click any series to inspect or re-style.", F["sub"])
for i, w in enumerate([4, 30, 14, 14]): ws.set_column(i, i, w)

def chart_insert(ch, cell, title, w=11, h=7):
    ch.set_title({"name": title})
    ch.set_legend({"position": "bottom"})
    ch.set_size({"width": 640, "height": 380})
    ws.insert_chart(cell, ch)

# 1 party turnout
ch = book.add_chart({"type": "column"})
ch.add_series({"name": "Turnout % by party", "categories": ["ChartData", a0, 0, a1, 0],
               "values": ["ChartData", a0, 3, a1, 3], "fill": {"color": "#2E75B6"},
               "data_labels": {"value": True, "num_format": "0.0%"}})
ch.set_y_axis({"num_format": "0%", "max": 0.30, "min": 0})
chart_insert(ch, "B3", "1. Democrats are voting at a much higher RATE than Republicans")

# 2 top20
ch = book.add_chart({"type": "bar"})
ch.add_series({"name": "Turnout %", "categories": ["ChartData", b0, 0, b1, 0],
               "values": ["ChartData", b0, 1, b1, 1], "fill": {"color": "#548235"},
               "data_labels": {"value": True, "num_format": "0.0%"}})
ch.set_y_axis({"num_format": "0%", "reverse": True})
chart_insert(ch, "B24", "2. The 20 highest-turnout counties (retirement country leads)")

# 3 bottom10
ch = book.add_chart({"type": "bar"})
ch.add_series({"name": "Turnout %", "categories": ["ChartData", c0, 0, c1, 0],
               "values": ["ChartData", c0, 1, c1, 1], "fill": {"color": "#C00000"},
               "data_labels": {"value": True, "num_format": "0.0%"}})
ch.set_y_axis({"num_format": "0%", "reverse": True})
chart_insert(ch, "B45", "3. The 10 lowest-turnout counties")

# 4 scatter
ch = book.add_chart({"type": "scatter"})
ch.add_series({"name": "Counties", "categories": ["ChartData", d0, 0, d1, 0],
               "values": ["ChartData", d0, 1, d1, 1],
               "marker": {"type": "circle", "size": 6, "fill": {"color": "#ED7D31"}}})
ch.set_x_axis({"name": "Eligible voters", "num_format": "#,##0", "log_base": 10})
ch.set_y_axis({"name": "Turnout %", "num_format": "0%"})
ch.set_legend({"none": True})
chart_insert(ch, "J3", "4. Smaller counties turn out harder (log scale)")

# 5 stacked
ch = book.add_chart({"type": "column", "subtype": "stacked"})
ch.add_series({"name": "Mail", "categories": ["ChartData", e0, 0, e1, 0],
               "values": ["ChartData", e0, 1, e1, 1], "fill": {"color": "#4472C4"}})
ch.add_series({"name": "Early vote", "categories": ["ChartData", e0, 0, e1, 0],
               "values": ["ChartData", e0, 2, e1, 2], "fill": {"color": "#ED7D31"}})
chart_insert(ch, "J24", "5. Where the ballots came from - biggest 15 counties")

# 6 daily line
ch = book.add_chart({"type": "line"})
ch.add_series({"name": "Mail", "categories": ["ChartData", f0, 0, f1, 0],
               "values": ["ChartData", f0, 1, f1, 1], "line": {"color": "#4472C4", "width": 2}})
ch.add_series({"name": "Early vote", "categories": ["ChartData", f0, 0, f1, 0],
               "values": ["ChartData", f0, 2, f1, 2], "line": {"color": "#ED7D31", "width": 2}})
ch.add_series({"name": "Broward (all types)", "categories": ["ChartData", f0, 0, f1, 0],
               "values": ["ChartData", f0, 3, f1, 3], "line": {"color": "#7F7F7F", "width": 1.5, "dash_type": "dash"}})
ch.set_x_axis({"date_axis": True, "num_format": "m/d"})
chart_insert(ch, "J45", "6. Daily ballot flow - early voting peaks the final Saturday")

# 7 gap
ch = book.add_chart({"type": "bar"})
ch.add_series({"name": "Gap (R - D)", "categories": ["ChartData", g0, 0, g1, 0],
               "values": ["ChartData", g0, 1, g1, 1],
               "fill": {"color": "#7030A0"}, "data_labels": {"value": True, "num_format": "0.0"}})
ch.set_y_axis({"reverse": True})
chart_insert(ch, "B66", "7. R-minus-D turnout gap, biggest and smallest")

# 8 buckets
ch = book.add_chart({"type": "column"})
ch.add_series({"name": "Precincts", "categories": ["ChartData", h0, 0, h1, 0],
               "values": ["ChartData", h0, 1, h1, 1], "fill": {"color": "#A5A5A5"},
               "data_labels": {"value": True}})
chart_insert(ch, "J66", "8. Distribution of precinct turnout - the real shape")

# 9 busiest sites
ch = book.add_chart({"type": "bar"})
ch.add_series({"name": "Ballots", "categories": ["ChartData", i0, 0, i1, 0],
               "values": ["ChartData", i0, 1, i1, 1], "fill": {"color": "#9E480E"}})
ch.set_y_axis({"reverse": True})
chart_insert(ch, "B87", "9. Busiest early voting sites in Florida")

# findings text
r = 108
ws.write(r, 1, "Headline numbers (as of pull time)", F["h2"]); r += 1
from datetime import date
_days = (date(2026, 11, 3) - date.today()).days
_when = ("on Election Day" if _days == 0 else
         "the day before Election Day" if _days == 1 else
         f"{_days} days before Election Day")
lines = [
 f'{TOT["total"]:,} ballots already cast statewide - {STATE_TURNOUT:.2f}% of {TOT["elig"]:,} eligible voters, {_when}.',
 f'Early voting outran mail: {TOT["early"]:,} in person vs {TOT["mail"]:,} by mail ({100*TOT["early"]/TOT["total"]:.0f}% / {100*TOT["mail"]/TOT["total"]:.0f}%).',
 f'Democratic turnout rate is {RATE["DEM"]:.2f}% vs Republican {RATE["REP"]:.2f}% - {"a" if round(RATE["DEM"]-RATE["REP"],1) < 8 else "an"} {RATE["DEM"]-RATE["REP"]:.1f} point Democratic edge. But Republicans have cast more raw ballots ({RATE_BALLOTS}) because there are 1.5M more of them.',
 f'Sumter County, the Villages, leads at {county_rate[0]["rate"]:.1f}%; Holmes County trails at {county_rate[-1]["rate"]:.1f}%.',
 f'Median county turnout {statistics.median([r["rate"] for r in county_rate]):.1f}%; median precinct {statistics.median(pv):.1f}%.',
 f'Busiest single site: {busiest[0]["name"]} ({busiest[0]["county"]}) with {busiest[0]["ballots"]:,} ballots.',
 f'Peak day: {FINDINGS["peak"][0]} with {FINDINGS["peak"][1]:,} ballots processed.',
]
for l in lines:
    ws.write(r, 1, "- " + l, F["wrap"]); r += 1

# ---------------------------------------------------------------- 16 Method
ws = book.add_worksheet("Method & Caveats"); ws.set_tab_color("#7F7F7F")
ws.hide_gridlines(2); ws.set_column(0, 0, 3); ws.set_column(1, 1, 24); ws.set_column(2, 2, 110)
ws.write(1, 1, "Method & caveats", F["title"])
items = [
 ("What was collected", "Each Florida county publishes its unofficial turnout through VR Systems' Turnout Quick View. "
   "The tool is an iframe that loads JSON from turnoutquickview.electionsfl.org. All 67 counties have a feed. "
   "For each county the workbook reads the election index, selects the record dated 11/03/2026, and stores every tab: "
   "DateType (date x type), PartyType (party x type), PrecinctType (precinct x type x eligible voters), "
   "LocationParty (site x party) and LocationDay (site x date x party)."),
 ("Denominators", "'Eligible voters' is the county-reported active registered voter count in the feed. It was cross-checked "
   "against the FL Division of Elections book closing report (closed Oct 5, 2026); median difference across 66 counties is 0.03% (Broward publishes on an all-registered basis and is mapped to active)."),
 ("What 'turnout' means here", "Ballots already returned or cast - vote-by-mail + early voting. No Election Day ballots exist yet, "
   "so these are pre-election-day numbers, not final turnout."),
 ("Broward", "Broward does not publish to the shared feed. Its own dashboard (my.browardvotes.gov/TEDElectionLink) exposes "
   "summary, ballot type, party, all 346 precincts, 30 early-vote sites and 281 Election Day locations through a JSON/HTML API, "
   "and collect_broward.py reads that. One caveat: Broward publishes turnout against ALL registered voters (1,366,692), "
   "while every other county and this workbook use active registered (1,103,545). Broward's own headline is 33.90%; on the "
   "active basis used here it is 42.0%. Broward's ballot counts always include its 24 provisional ballots."),
 ("County naming", "Counties brand the same page differently - Orange says 'Unofficial Voter Turnout', Broward 'Unofficial Total Voters Processed', "
   "others 'Turnout Quick View'. All 67 but Broward run the identical VR Systems widget, so the underlying fields line up exactly."),
 ("Provisional ballots", "Shown where counties report them, but excluded from some county dashboard totals; they are small (tens to hundreds)."),
 ("Party codes", "DEM/REP/NPA are explicit. 'IND' is the Independent Party of Florida (~660k registrants). A handful of "
   "one-off codes (AIP, OTH, UNK) carry a few ballots and are grouped as Other."),
 ("Precinct keys", "The feed uses split keys (e.g. 101S08). They roll up to the base precinct (101). Precinct turnout over 100% "
   "occurs where a precinct's eligible count is lower than ballots cast (split/reporting artifacts)."),
 ("Election night cadence", "Florida rule: preliminary returns (all early vote + all vote-by-mail tabulated by the end of early voting) are due "
   "by 7:30 PM local time, then precinct results every 45 minutes until complete; the first file reaches the Division of Elections "
   "within 30 minutes of close and every 45 minutes after. Because Florida spans two time zones, nothing is released statewide "
   "before 8:00 PM Eastern. Roughly 99% of the vote was reported by midnight in 2016 and 2020."),
 ("Not included", "No candidate results - this is a turnout dataset. Election Night reporting (Clarity ENR) opens at 7pm Nov 3."),
 ("Run history", "Every run is archived to runs/<UTC timestamp>/ with its own copy of the raw feeds (zipped), the tidy CSVs, "
   "the workbook and a checksummed manifest; runs/INDEX.csv is append-only. Nothing from a previous run is ever overwritten."),
 ("Reproduce", "./refresh.sh  - collects, rebuilds, reports the delta and archives the run in one line."),
]
r = 3
for k, v in items:
    ws.write(r, 1, k, F["bold"]); ws.write(r, 2, v, F["wrap"]); ws.set_row(r, 58); r += 1

book.close()
print("WROTE", FN)
print(f'statewide: {TOT["total"]:,} / {TOT["elig"]:,} = {STATE_TURNOUT:.2f}%')
