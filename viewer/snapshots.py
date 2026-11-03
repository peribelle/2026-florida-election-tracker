"""Loaders for the viewer's second half: archived turnout runs and election-night results snapshots.

Pure functions, filesystem in and JSON-able dicts out. Nothing here writes to runs/ or results/.

Layout read (see AGENTS.md section 7):
  runs/INDEX.csv, runs/<id>/data/{by_type,by_party}.csv          archived turnout pulls
  results/INDEX.csv, results/<id>/                               Florida Election Watch + county ENR pulls
      contest_votes.csv county_status.csv ed_turnout.csv county_contests.csv county_enr_status.csv
      raw/precinct_<CODE>.csv.gz
  results/slow/INDEX.csv, results/slow/<id>/raw/precinct_<CODE>.csv.gz

Everything is aligned to the viewer's county index (alphabetical, 67 entries) so the page can use plain
arrays. Missing numbers are -1 where "not reported yet" differs from zero, otherwise 0.
"""
import csv, glob, gzip, io, json, os, re
from collections import OrderedDict, defaultdict
from datetime import datetime, timezone

try:                                   # tzdata ships in the venv; the fallback is the election-week offset
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:                      # pragma: no cover
    ET = timezone(__import__("datetime").timedelta(hours=-5))

RUN_ID = re.compile(r"^\d{8}-\d{6}$")
PRIMARY = re.compile(r"\((REP|DEM|UPC)\)\s*$")          # AGENTS.md section 9: a primary leaks in as "Governor (REP)"
GENERAL_DATES = {"11/3/2026", "11/03/2026"}


# ---------------------------------------------------------------- small helpers
def n2(s):
    """Match county names across feeds: 'St. Johns' == 'ST JOHNS' == 'StJohns'."""
    return re.sub(r"[^A-Z]", "", (s or "").upper())


def to_num(x, default=0):
    s = str(x if x is not None else "").replace(",", "").replace("%", "").strip()
    if s in ("", "-", "--"):
        return default
    try:
        v = float(s)
        return int(v) if v == int(v) else v
    except ValueError:
        return default


def rows_of(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def utc_from_local_id(rid):
    """20261102-215553 is local Eastern time."""
    dt = datetime.strptime(rid, "%Y%m%d-%H%M%S").replace(tzinfo=ET)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_utc(s, rid=None):
    s = (s or "").strip()
    if s:
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=ET)
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            pass
    return utc_from_local_id(rid) if rid and RUN_ID.match(rid) else None


# ---------------------------------------------------------------- archived turnout runs
def load_turnout_runs(runs_dir, cidx, ckey):
    """One entry per row of runs/INDEX.csv. Runs that kept their data/ folder also carry per-county arrays:
    d = [mail, early, election day, provisional] x 67 (flat) and p = [REP, DEM, NPA, other] ballots x 67 (flat)."""
    n = len(cidx)
    out = []
    for r in rows_of(os.path.join(runs_dir, "INDEX.csv")):
        rid = r["run_id"]
        snap = {"id": rid, "t": to_utc(r.get("created_utc"), rid), "feed": r.get("feed_time") or None,
                "ballots": to_num(r.get("ballots")), "mail": to_num(r.get("mail")), "early": to_num(r.get("early")),
                "ed": to_num(r.get("election_day")), "prov": to_num(r.get("provisional")),
                "elig": to_num(r.get("eligible")), "rate": to_num(r.get("turnout_pct")), "note": (r.get("note") or "").strip(),
                "d": None, "p": None}
        base = os.path.join(runs_dir, rid, "data")
        types = rows_of(os.path.join(base, "by_type.csv"))
        if types:
            slot = {"Mail": 0, "EarlyVoting": 1, "ElectionDay": 2, "Provisional": 3}
            d = [0] * (n * 4)
            for t in types:
                i = cidx.get(ckey(t["county"]))
                if i is not None and t["ballot_type"] in slot:
                    d[i * 4 + slot[t["ballot_type"]]] += to_num(t["ballots"])
            snap["d"] = d
            p = [0] * (n * 4)
            grp = {"REP": 0, "DEM": 1, "NPA": 2}
            for t in rows_of(os.path.join(base, "by_party.csv")):
                i = cidx.get(ckey(t["county"]))
                if i is not None:
                    p[i * 4 + grp.get(t["party_code"], 3)] += to_num(t["total"])
            snap["p"] = p
        out.append(snap)
    out.sort(key=lambda s: s["t"] or "")
    return out


# ---------------------------------------------------------------- contest naming
def race_kind(cid, name):
    c = str(cid)
    if c.startswith("12"): return "senate"
    if c.startswith("14"): return "house"
    if c.startswith("16"): return "exec"
    if c.startswith("24"): return "sdist"
    if c.startswith("26"): return "hdist"
    if c.startswith("9"): return "amend"
    if c.startswith("5"): return "judicial"
    n = name.lower()
    if "amendment" in n or "(nonpartisan)" in n and "retain" not in n and "judge" not in n: return "amend"
    return "other"


def race_names(cid, raw_name, kind):
    """(title, short) for a statewide-feed contest."""
    n = re.sub(r"\s*\((General|Nonpartisan)\)\s*$", "", raw_name).strip()
    m = re.search(r"District (\d+)", n)
    num = int(m.group(1)) if m else None
    if kind == "exec" and n.lower().startswith("governor"): return "Governor", "Governor"
    if kind == "exec" and "attorney" in n.lower(): return "Attorney General", "Attorney Gen."
    if kind == "exec" and "financial" in n.lower(): return "Chief Financial Officer", "CFO"
    if kind == "exec" and "agricultur" in n.lower(): return "Commissioner of Agriculture", "Agriculture"
    if kind == "senate": return "U.S. Senate", "U.S. Senate"
    if kind == "house": return f"U.S. House, District {num}", f"FL-{num}"
    if kind == "sdist": return f"State Senate, District {num}", f"SD {num}"
    if kind == "hdist": return f"State House, District {num}", f"HD {num}"
    if kind == "amend":
        k = int(str(cid)[-1]) if str(cid).startswith("9") and str(cid)[-1].isdigit() else None
        return (f"Amendment {k}: {n}" if k else n), (f"Amendment {k}" if k else n[:24])
    if kind == "judicial":
        m2 = re.match(r"Shall (Justice|Judge) (.+?) be retained", n)
        if m2:
            last = m2.group(2).split()[-1]
            return f"Retain {m2.group(1)} {m2.group(2)}", f"Retain {last}"
        return n, n[:28]
    return n, n[:28]


def cand_short(name, party):
    """'Byron Donalds and Bryan Avila' -> 'Donalds / Avila'; 'Yes' stays 'Yes'."""
    if name in ("Yes", "No") or name.startswith(("Yes for", "No for")): return name.split()[0]
    parts = [p.strip() for p in re.split(r"\s+and\s+", name)] if " and " in name else [name]
    def last(p):
        p = re.sub(r'"[^"]*"', "", p)
        toks = [t for t in re.split(r"\s+", p.strip()) if t and t.lower().strip(".,") not in ("jr", "sr", "ii", "iii", "iv")]
        return toks[-1] if toks else p
    return " / ".join(last(p) for p in parts)


PARTY_CODES = "REP|DEM|NPA|LPF|GRE|CPF|AMF|ASP|BPP|CPP|CSV|ECO|FFP|IND|JEF|MGT|PSL|WTP|WPF|AIP|OTH|NON|WRI"


def clean_candidate(name, party):
    """County feeds sometimes prefix a party code ("NPA Charles Burkett") or tack on "(NON)" and stray whitespace."""
    n = re.sub(r"\s+", " ", name or "").strip()
    m = re.match(rf"^({PARTY_CODES})\s+(.+)$", n)
    if m:
        party = party or m.group(1)
        n = m.group(2)
    n = re.sub(r"\s*\((?:NON|[A-Z]{3})\)\s*$", "", n).strip()
    return n, (party or "")


# the county feeds label the same statewide race many ways
STATE_PATTERNS = [
    ("160000", re.compile(r"^gov", re.I)),
    ("120000", re.compile(r"united states senat|u\.?s\.? senat", re.I)),
    ("160200", re.compile(r"attorney general", re.I)),
    ("160500", re.compile(r"chief financial|^cfo", re.I)),
    ("160800", re.compile(r"agricultur", re.I)),
]
AMEND = re.compile(r"(?:no\.?\s*)?([123])\s*constitutional amendment", re.I)


def match_statewide(contest):
    for cid, pat in STATE_PATTERNS:
        if pat.search(contest):
            return cid
    m = AMEND.search(contest)
    return f"90000{m.group(1)}" if m else None


def match_candidate(name, party, cands):
    """Join a county-feed candidate to the statewide feed's list. cands = [(name, party), ...] -> index or -1."""
    nm = name.strip().lower()
    if nm.startswith("yes") or nm.startswith("no/") or nm == "no":     # "Yes/Si", "No/No": bilingual ballots
        target = "yes" if nm.startswith("yes") else "no"
        for i, (cn, cp) in enumerate(cands):
            if cn.lower() == target or cn.lower().startswith(target + " for"):
                return i
    for i, (cn, cp) in enumerate(cands):
        if cn.lower() == nm or cn.lower().startswith(nm + " and "):
            return i
    same = [i for i, (cn, cp) in enumerate(cands) if party and cp == party]
    if len(same) == 1:
        return same[0]
    first = nm.split()[0] if nm.split() else nm
    for i, (cn, cp) in enumerate(cands):
        if cn.lower().startswith(first) and nm.split()[-1] in cn.lower():
            return i
    return -1


# ---------------------------------------------------------------- results snapshots
def load_checks(val_dir):
    """What the two validators (validate.py) have flagged: the open alerts, and the recent alert log. None until they have run.

    Reads validation/ only. Never raises: a problem here must cost the page its checks card, never the page itself."""
    try:
        with open(os.path.join(val_dir, "current.json"), encoding="utf-8") as f:
            cur = json.load(f)
    except (OSError, ValueError):
        return None

    def slim(r):
        return {"t": int(r.get("tier") or 3), "v": r.get("validator", ""), "k": r.get("kind", ""), "h": r.get("headline", ""),
                "d": (r.get("detail") or "")[:260], "u": r.get("raised_utc", ""), "e": r.get("event") or r.get("state") or "", "s": r.get("source", "")}
    log = []
    try:
        with open(os.path.join(val_dir, "alerts.csv"), newline="", encoding="utf-8") as f:
            log = [slim(r) for r in list(csv.DictReader(f))[-150:]]
    except (OSError, ValueError):
        pass
    try:
        return {"status": cur.get("status", "clear"), "counts": cur.get("counts", {}), "asOf": cur.get("generated_utc", ""), "window": cur.get("window_hours", 3),
                "totals": cur.get("totals", {}), "items": [slim(i) for i in cur.get("items", [])], "log": log, "validated": cur.get("validated", {})}
    except (AttributeError, TypeError, ValueError):
        return None


def list_snapshot_dirs(results_dir):
    return sorted(d for d in os.listdir(results_dir) if RUN_ID.match(d) and os.path.isdir(os.path.join(results_dir, d)))


def load_results(results_dir, cidx_by_name, code_to_idx):
    """All Florida Election Watch + county ENR snapshots, aligned and delta-encoded. Returns a dict for the page."""
    n = len(code_to_idx)
    index = {r["run_id"]: r for r in rows_of(os.path.join(results_dir, "INDEX.csv"))}
    ids = list_snapshot_dirs(results_dir)

    # ---- pass 1: union structure over every snapshot, in time order
    races = OrderedDict()            # contest_id -> {name, kind, cands: OrderedDict, rows: OrderedDict}
    lraces = OrderedDict()           # (county idx, contest) -> {cands: OrderedDict, stat}
    loaded = {}
    for rid in ids:
        base = os.path.join(results_dir, rid)
        ew = rows_of(os.path.join(base, "contest_votes.csv"))
        cc = [r for r in rows_of(os.path.join(base, "county_contests.csv")) if not PRIMARY.search(r["contest"])]
        for r in cc:
            r["candidate"], r["party"] = clean_candidate(r["candidate"], r["party"])
            r["contest"] = re.sub(r"\s+", " ", r["contest"]).strip()
        loaded[rid] = {"ew": ew, "cc": cc,
                       "cs": rows_of(os.path.join(base, "county_status.csv")), "ed": rows_of(os.path.join(base, "ed_turnout.csv")),
                       "enr": [r for r in rows_of(os.path.join(base, "county_enr_status.csv")) if r.get("election_date") in GENERAL_DATES or not r.get("election_date")]}
        for r in ew:
            rc = races.setdefault(r["contest_id"], {"name": r["contest"], "cands": OrderedDict(), "rows": OrderedDict()})
            rc["cands"].setdefault((r["candidate"], r["party"]), len(rc["cands"]))
            if r["contest"].strip():
                rc["name"] = r["contest"].strip()
            who = r["county"].strip()
            key = -1 if who.upper() in ("TOTAL", "TOTALS", "STATEWIDE") else cidx_by_name.get(n2(who))
            if key is not None:
                rc["rows"].setdefault(key, len(rc["rows"]))
        for r in cc:
            ci = code_to_idx.get(r["county_code"])
            if ci is None:
                continue
            lr = lraces.setdefault((ci, r["contest"]), {"cands": OrderedDict()})
            lr["cands"].setdefault((r["candidate"], r["party"]), len(lr["cands"]))

    race_ids = list(races)
    race_pos = {c: i for i, c in enumerate(race_ids)}
    race_out = []
    for cid in race_ids:
        rc = races[cid]
        kind = race_kind(cid, rc["name"])
        title, short = race_names(cid, rc["name"], kind)
        m = re.search(r"District (\d+)", title)
        race_out.append({"id": cid, "name": title, "short": short, "kind": kind, "num": int(m.group(1)) if m else None,
                         "cands": [[c, p, cand_short(c, p)] for (c, p) in rc["cands"]], "rows": list(rc["rows"])})

    lr_keys = list(lraces)
    lr_out, lr_offset, total_cands = [], {}, 0
    for k in lr_keys:
        ci, contest = k
        cands = list(lraces[k]["cands"])
        sid = match_statewide(contest)
        statewide_idx = race_pos.get(sid, -1) if sid else -1
        lr_out.append({"ci": ci, "name": contest, "sw": statewide_idx,
                       "cands": [[c, p] for (c, p) in cands],
                       "map": ([match_candidate(c, p, [(cc_[0], cc_[1]) for cc_ in races[sid]["cands"]]) for (c, p) in cands]
                               if statewide_idx >= 0 else [])})
        lr_offset[k] = total_cands
        total_cands += len(cands)

    enr_codes = sorted({r["county_code"] for rid in ids for r in loaded[rid]["enr"] if r["county_code"] in code_to_idx})
    enr_pos = {c: i for i, c in enumerate(enr_codes)}

    # ---- pass 2: per snapshot arrays
    snaps, ew_delta, cs_all, ed_all, lv_all, enr_all = [], [], [], [], [], []
    prev_ew, prev_lv = {}, None
    for rid in ids:
        L = loaded[rid]
        idx_row = index.get(rid, {})
        summary = {}
        sp = os.path.join(results_dir, rid, "summary.json")
        if os.path.exists(sp):
            try:
                summary = json.load(open(sp))
            except ValueError:
                summary = {}
        # statewide feed votes
        flat = {}
        for r in L["ew"]:
            ri = race_pos[r["contest_id"]]
            rc = races[r["contest_id"]]
            who = r["county"].strip()
            key = -1 if who.upper() in ("TOTAL", "TOTALS", "STATEWIDE") else cidx_by_name.get(n2(who))
            if key is None:
                continue
            arr = flat.setdefault(ri, [0] * (len(rc["rows"]) * len(rc["cands"])))
            arr[rc["rows"][key] * len(rc["cands"]) + rc["cands"][(r["candidate"], r["party"])]] = to_num(r["votes"])
        changed = {str(ri): arr for ri, arr in flat.items() if prev_ew.get(ri) != arr}
        for ri in flat:
            prev_ew[ri] = flat[ri]
        ew_delta.append(changed)
        # status tables
        cs = [-1] * (n * 6)
        for r in L["cs"]:
            i = cidx_by_name.get(n2(r["county"]))
            if i is not None:
                for j, k in enumerate(("voter_turnout", "precincts_reporting_pct", "precincts_completed_pct",
                                       "vbm_completed", "early_completed", "provisional_completed")):
                    v = r.get(k, "")
                    cs[i * 6 + j] = to_num(v, -1) if str(v).strip() != "" else -1
        cs_all.append(cs)
        ed = [-1] * n
        for r in L["ed"]:
            i = cidx_by_name.get(n2(r["county"]))
            if i is not None and str(r.get("turnout", "")).strip() != "":
                ed[i] = to_num(r["turnout"], -1)
        ed_all.append(ed)
        # county ENR totals
        lv = [0] * total_cands
        for r in L["cc"]:
            ci = code_to_idx.get(r["county_code"])
            if ci is None:
                continue
            k = (ci, r["contest"])
            lv[lr_offset[k] + lraces[k]["cands"][(r["candidate"], r["party"])]] = to_num(r["total"])
        lv_all.append(None if prev_lv == lv else lv)
        prev_lv = lv
        enr = [-1] * (len(enr_codes) * 3)
        for r in L["enr"]:
            if r["county_code"] in enr_pos:
                j = enr_pos[r["county_code"]] * 3
                enr[j] = to_num(r["ballots_cast"], -1); enr[j + 1] = to_num(r["precincts_reporting"], -1); enr[j + 2] = to_num(r["precincts_total"], -1)
        enr_all.append(enr)

        has_ew = bool(L["ew"])
        votes_total = sum(to_num(r["votes"]) for r in L["ew"] if r["county"].strip().upper() == "TOTAL")
        snaps.append({
            "id": rid, "t": to_utc(idx_row.get("created_utc") or summary.get("created_utc"), rid),
            "ballots": to_num(idx_row.get("ballots", summary.get("ballots", 0))),
            "elig": to_num(idx_row.get("eligible", summary.get("eligible", 0))),
            "rate": to_num(idx_row.get("turnout_pct", summary.get("turnout_pct", 0))),
            "cr": to_num(idx_row.get("counties_reporting", summary.get("counties_reporting", 0))),
            "cv": to_num(idx_row.get("contests_with_votes", 0)),
            "note": (idx_row.get("note") or "").strip(),
            "enrOk": to_num(idx_row.get("county_enr_ok", (summary.get("county_enr") or {}).get("counties_ok", 0))),
            "precOk": to_num(idx_row.get("precinct_ok", (summary.get("precincts") or {}).get("counties_ok", 0))),
            "precRows": to_num(idx_row.get("precinct_rows", (summary.get("precincts") or {}).get("rows", 0))),
            "has": {"ew": int(has_ew), "enr": int(bool(L["cc"])), "prec": int(os.path.isdir(os.path.join(results_dir, rid, "precincts")))},
            "votes": votes_total,
        })

    latest = ids[-1] if ids else None
    last = loaded.get(latest, {}) if latest else {}
    ed_last = [""] * n
    for r in last.get("ed", []):
        i = cidx_by_name.get(n2(r["county"]))
        if i is not None:
            ed_last[i] = (r.get("last_reported") or "").strip()
    enr_last, enr_url = [""] * len(enr_codes), [""] * len(enr_codes)
    for r in last.get("enr", []):
        if r["county_code"] in enr_pos:
            enr_last[enr_pos[r["county_code"]]] = (r.get("last_updated") or "").strip()
            enr_url[enr_pos[r["county_code"]]] = r.get("url") or ""
    # voting-method split, latest snapshot only: [election day, early, mail, provisional] per candidate
    lm = [0] * (total_cands * 4)
    for r in last.get("cc", []):
        ci = code_to_idx.get(r["county_code"])
        if ci is not None:
            k = (ci, r["contest"])
            o = (lr_offset[k] + lraces[k]["cands"][(r["candidate"], r["party"])]) * 4
            lm[o:o + 4] = [to_num(r["election_day"]), to_num(r["early"]), to_num(r["mail"]), to_num(r["provisional"])]

    return {"snaps": snaps, "races": race_out, "ew": ew_delta, "cs": cs_all, "ed": ed_all, "edLast": ed_last,
            "lraces": lr_out, "lv": lv_all, "lm": lm,
            "enr": {"ci": [code_to_idx[c] for c in enr_codes], "st": enr_all, "last": enr_last, "url": enr_url}}


# ---------------------------------------------------------------- precinct-level results (latest pulls only)
def _precinct_rows(path):
    """Rows from either header style: Clarity's export, or the slow path's lower-case columns."""
    try:
        text = gzip.open(path, "rt", encoding="utf-8-sig", newline="").read()
    except (OSError, EOFError):
        return []
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        g = lambda *ks: next((r[k] for k in ks if k in r and r[k] is not None), "")
        out.append((g("Contest", "contest").strip(), g("Candidate Issue", "candidate").strip(), g("Party", "party").strip(),
                    g("Precinct Name", "precinct").strip(), to_num(g("Total Votes", "total"))))
    return out


def load_precincts(results_dir, races, code_to_idx):
    """Statewide races and amendments by precinct, from the newest fast and slow pulls. Local contests stay in the
    workbooks; they would triple the page for little gain. Returns {counties: [...]} or None."""
    if not races:
        return None
    race_by_id = {r["id"]: i for i, r in enumerate(races)}
    sources = []
    fast = [d for d in list_snapshot_dirs(results_dir) if glob.glob(os.path.join(results_dir, d, "raw", "precinct_*.csv.gz"))]
    slow_root = os.path.join(results_dir, "slow")
    slow = sorted(d for d in (os.listdir(slow_root) if os.path.isdir(slow_root) else [])
                  if RUN_ID.match(d) and glob.glob(os.path.join(slow_root, d, "raw", "precinct_*.csv.gz")))
    seen = {}
    for kind, root, ids in (("slow", slow_root, slow[-1:]), ("fast", results_dir, fast[-1:])):   # fast wins on overlap
        for d in ids:
            for p in glob.glob(os.path.join(root, d, "raw", "precinct_*.csv.gz")):
                code = os.path.basename(p)[len("precinct_"):-len(".csv.gz")]
                if code in code_to_idx:
                    seen[code] = (kind, d, p)
    counties = []
    for code, (kind, snap, path) in sorted(seen.items(), key=lambda kv: code_to_idx[kv[0]]):
        rows = _precinct_rows(path)
        precincts = list(OrderedDict.fromkeys(r[3] for r in rows if r[3]))
        pidx = {p: i for i, p in enumerate(precincts)}
        data = {}
        for contest, cand, party, precinct, total in rows:
            sid = match_statewide(contest)
            if not sid or sid not in race_by_id or precinct not in pidx:
                continue
            ri = race_by_id[sid]
            cands = [(c[0], c[1]) for c in races[ri]["cands"]]
            ci = match_candidate(cand, party, cands)
            if ci < 0:
                continue
            arr = data.setdefault(ri, [0] * (len(precincts) * len(cands)))
            arr[pidx[precinct] * len(cands) + ci] = total
        if data:
            counties.append({"ci": code_to_idx[code], "src": kind, "snap": snap, "precincts": precincts,
                             "races": {str(ri): arr for ri, arr in data.items()}})
    return {"counties": counties} if counties else None


def load_slow_index(results_dir):
    out = []
    for r in rows_of(os.path.join(results_dir, "slow", "INDEX.csv")):
        out.append({"id": r["run_id"], "t": to_utc(None, r["run_id"]) if RUN_ID.match(r["run_id"]) else None,
                    "ok": to_num(r.get("counties_ok")), "targeted": to_num(r.get("counties_targeted")), "rows": to_num(r.get("rows"))})
    return out


# ---------------------------------------------------------------- projections (forecasts, markets, race calls)
# See AGENTS.md section 7.5. These are predictions, never counted votes; they get their own payload key and the page
# never adds them to results numbers.
PROJ_SOURCES = ["ddhq", "kalshi", "polymarket"]


def proj_party(p):
    """DDHQ and the markets say GOP; everything else in the viewer says REP."""
    p = (p or "").strip().upper()
    return "REP" if p == "GOP" else p


def _clean_name(n):
    return re.sub(r"\s+", " ", (n or "").strip())


def _surname(n):
    parts = re.sub(r"[^A-Za-z' -]", " ", n or "").replace(" and ", " / ").split("/")[0].split()
    return parts[-1].lower() if parts else ""


def proj_race_id(key, races):
    """FL-GOV / FL-SEN / FL-CFO / FL-AG / FL-AGR / FL-H01..28 -> the id of the matching race in the results feed."""
    def by_name(name):
        return next((r["id"] for r in races if r["kind"] == "exec" and r["name"].strip().lower() == name), None)
    if key == "FL-GOV":
        return next((r["id"] for r in races if r["kind"] == "exec" and r["name"].lower().startswith("governor")), None)
    if key == "FL-SEN":
        return next((r["id"] for r in races if r["kind"] == "senate"), None)
    if key == "FL-CFO":
        return by_name("chief financial officer")
    if key == "FL-AG":
        return by_name("attorney general")
    if key == "FL-AGR":
        return by_name("commissioner of agriculture")
    m = re.match(r"^FL-H(\d+)$", key)
    if m:
        n = int(m.group(1))
        return next((r["id"] for r in races if r["kind"] == "house" and (r.get("num") == n or re.search(rf"District {n}$", r["name"]))), None)
    return None


def load_projections(proj_dir, races):
    """projections/INDEX.csv plus each snapshot's predictions.csv and calls.csv.

    Every forecast race has *sides* (a party, usually with a candidate name). Rows from all sources are folded onto the
    same sides by party, so DDHQ, Kalshi (candidate level) and Polymarket (party level) line up.
        snaps   one entry per production pull: time, which sources answered, counts
        races   {key, rid, name, office, district, sides: [{p, n, k}]}  k = index into the results race's candidates
        pred    per snapshot: [[race, side, source, probability, volume or null], ...]
        calls   per snapshot: [[race, side or -1, called_at_utc, candidate, party], ...] (winners only)
        latest  the newest snapshot's extra detail: prices, volumes, when each source last changed, DDHQ's own tally
    """
    index = rows_of(os.path.join(proj_dir, "INDEX.csv"))
    if not index:
        return None
    index.sort(key=lambda r: r["run_id"])
    races = races or []
    race_by_key, race_list = {}, []

    def race_of(key, name, office, district):
        if key not in race_by_key:
            race_by_key[key] = len(race_list)
            race_list.append({"key": key, "rid": proj_race_id(key, races), "name": name or key, "office": office or "", "district": district or "", "sides": []})
        return race_by_key[key]

    def side_of(ri, party, name, create=True):
        sides = race_list[ri]["sides"]
        same = [i for i, s in enumerate(sides) if party and s["p"] == party]
        if len(same) == 1:
            if name and not sides[same[0]]["n"]:
                sides[same[0]]["n"] = name
            return same[0]
        if len(same) > 1 or (not party and sides):
            sn = _surname(name)
            hit = [i for i in (same or range(len(sides))) if sn and _surname(sides[i]["n"]) == sn]
            if hit:
                return hit[0]
        if not create:
            return -1
        sides.append({"p": party, "n": name, "k": -1})
        return len(sides) - 1

    snaps, preds, calls, latest = [], [], [], None
    for r in index:
        rid = r["run_id"]
        base = os.path.join(proj_dir, rid)
        prows = sorted(rows_of(os.path.join(base, "predictions.csv")), key=lambda x: (PROJ_SOURCES.index(x["source"]) if x["source"] in PROJ_SOURCES else 9))
        crows = rows_of(os.path.join(base, "calls.csv"))
        p_out, c_out, detail = [], [], []
        for x in prows:
            prob = to_num(x.get("win_probability"), None)
            if prob is None or x["source"] not in PROJ_SOURCES or not x.get("race_key"):
                continue
            if not (x.get("candidate") or "").strip() and not (x.get("party") or "").strip():
                continue                      # DDHQ's placeholder row for an unopposed seat: nobody to attach it to
            ri = race_of(x["race_key"], x.get("race"), x.get("office"), x.get("district"))
            si = side_of(ri, proj_party(x.get("party")), _clean_name(x.get("candidate")))
            src = PROJ_SOURCES.index(x["source"])
            vol = to_num(x.get("volume"), None) if str(x.get("volume") or "").strip() else None
            p_out.append([ri, si, src, round(float(prob), 4), vol])
            detail.append([ri, si, src, round(float(prob), 4), to_num(x.get("price_cents"), None) if str(x.get("price_cents") or "").strip() else None,
                           to_num(x.get("bid_cents"), None) if str(x.get("bid_cents") or "").strip() else None,
                           to_num(x.get("ask_cents"), None) if str(x.get("ask_cents") or "").strip() else None, vol, (x.get("source_updated_at") or "").strip()])
        dd = {}
        for x in crows:
            if not x.get("race_key"):
                continue
            ri = race_by_key.get(x["race_key"])
            if ri is None:
                ri = race_of(x["race_key"], x.get("race"), x.get("office"), x.get("district"))
            if str(x.get("winner", "")).strip().lower() == "true":
                nm = _clean_name(x.get("candidate")); pt = proj_party(x.get("party"))
                c_out.append([ri, side_of(ri, pt, nm, create=False), (x.get("called_at_utc") or "").strip(), nm, pt])
            if x["race_key"] not in dd:
                dd[x["race_key"]] = [to_num(x.get("precincts_in")), to_num(x.get("precincts_total"))]
        ok = [int(to_num(r.get(f"{s}_ok"), 0)) for s in PROJ_SOURCES]
        snaps.append({"id": rid, "t": to_utc(r.get("created_utc"), rid), "ok": ok, "races": int(to_num(r.get("races_forecast"))), "rows": int(to_num(r.get("prediction_rows"))),
                      "calls": int(to_num(r.get("call_rows"))), "called": int(to_num(r.get("called_candidates"))),
                      "maxDiv": to_num(r.get("max_divergence"), None) if str(r.get("max_divergence") or "").strip() else None,
                      "note": (r.get("note") or "").strip(), "has": int(bool(prows))})
        preds.append(p_out); calls.append(c_out)
        if prows:
            latest = {"rows": detail, "dd": {race_by_key[k]: v for k, v in dd.items() if k in race_by_key}}
    # candidates on a side -> the matching candidate of the results race (same party, surname breaks ties)
    by_id = {r["id"]: r for r in races}
    for pr in race_list:
        rr = by_id.get(pr["rid"])
        for s in pr["sides"]:
            if not rr:
                continue
            same = [i for i, c in enumerate(rr["cands"]) if proj_party(c[1]) == s["p"]]
            if len(same) > 1:
                same = [i for i in same if _surname(rr["cands"][i][0]) == _surname(s["n"])] or same
            s["k"] = same[0] if same else -1
    return {"src": PROJ_SOURCES, "snaps": snaps, "races": race_list, "pred": preds, "calls": calls, "latest": latest}
