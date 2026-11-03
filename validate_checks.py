#!/usr/bin/env python3
"""The checks behind the two validators. Pure functions: snapshots in, findings out. Nothing here writes a file.

SOURCE checks ask "did the pull work?". They compare a pull with the best this pipeline has managed before (its
high-water mark), because the set of county sites that publish results grows through the night but must never shrink.

DATA checks ask "do the numbers make sense?". Counts that can only grow are compared pull to pull for every race, county,
precinct and number; parts must add up to wholes; nothing may be negative or impossible.

A finding is a dict:
  validator  "source" | "data"
  kind       the check, e.g. "votes_down"
  tier       1 critical (look now), 2 warning (look soon), 3 notice (good to know)
  mode       "event" (a change between two pulls, true once) or "condition" (stays true until fixed; the engine dedupes it)
  scope      what it is about, stable from pull to pull for conditions: "FEW|160000|Alachua"
  headline   one line a person can read
  detail     examples
  prev, curr, delta, count   numbers, when there are some
  rows       every row-level finding behind the headline (written to validation/<run>/findings.csv, never dropped)

Thresholds are constants below so they can be tuned in one place. Tiers by size, for a count that went DOWN by d from p:
  votes    T1 d >= 500, or d >= 50 and 2% of p   | T2 d >= 10 | T3 smaller
  ballots  T1 d >= 2000, or d >= 200 and 2% of p | T2 d >= 50 | T3 smaller   (hourly turnout totals are bigger numbers)
"""
import csv, glob, gzip, json, os, re, zipfile
from collections import defaultdict, namedtuple
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
Snap = namedtuple("Snap", "kind id path t")

# ---- the election calendar: same names and defaults as election_day.sh, so one override moves both -----------------
ELECTION_DATE = date.fromisoformat(os.environ.get("ELECTION_DATE", "2026-11-03"))
TURNOUT_START = int(os.environ.get("TURNOUT_START", "7"))
POLLS_CLOSE = int(os.environ.get("POLLS_CLOSE", "19"))
RESULTS_END = int(os.environ.get("RESULTS_END", "3"))
RESULTS_EVERY = int(os.environ.get("RESULTS_EVERY", "10"))
TURNOUT_EVERY = int(os.environ.get("TURNOUT_EVERY", "60"))

GENERAL = {"11/3/2026", "11/03/2026"}
PRIMARY = re.compile(r"\((REP|DEM|UPC)\)\s*$")          # AGENTS.md section 9: a primary leaks in as "Governor (REP)"
TOTAL_NAMES = {"TOTAL", "TOTALS", "STATEWIDE"}

# a pull is expected this often; a gap bigger than GAP_FACTOR cadences, inside the schedule, is a missed pull
CADENCE = {"turnout": 3600, "results": 600, "slow": 1800, "projections": 1800}
GAP_FACTOR = 1.6
MASS_FRACTION = 0.5          # this share of a table vanishing at once is a reshaped feed, not a thousand small losses
MIN_FOR_MASS = 20

# ---- tiny helpers ------------------------------------------------------------------------------------------------


def num(x):
    """'1,234' -> 1234, '12.5' -> 12.5, '', '-', None, 'n/a' -> None."""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return x
    s = str(x).replace(",", "").replace("%", "").strip()
    if s in ("", "-", "--"):
        return None
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return None


def j(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def read_csv(path):
    """Rows as dicts, or None if the file is not there (an empty table and a missing one are different things)."""
    try:
        with open(path, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))
    except FileNotFoundError:
        return None


def read_gz_csv(path):
    try:
        with gzip.open(path, "rt", newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))
    except FileNotFoundError:
        return None


def count_rows(path):
    """Data rows in a csv.gz, or -1 if the file is unreadable (a truncated download)."""
    try:
        with gzip.open(path, "rb") as f:
            return sum(1 for _ in f) - 1
    except (OSError, EOFError):
        return -1


def f(n):
    return f"{n:,}" if isinstance(n, int) else (f"{n:,.2f}" if isinstance(n, float) else str(n))


def pl(n, word):
    """1 row, 2 rows."""
    return f"{n:,} {word}{'' if n == 1 else 's'}"


def short(s, n=70):
    s = str(s)
    return s if len(s) <= n else s[:n - 1] + "…"


def finding(validator, kind, tier, mode, scope, headline, detail="", **kw):
    out = {"validator": validator, "kind": kind, "tier": tier, "mode": mode, "scope": scope, "headline": headline,
           "detail": detail, "prev": None, "curr": None, "delta": None, "count": 1, "rows": []}
    out.update(kw)
    return out


def vote_tier(p, c):
    d = p - c
    if d >= 500 or (d >= 50 and d >= 0.02 * p):
        return 1
    return 2 if d >= 10 else 3


def ballot_tier(p, c):
    d = p - c
    if d >= 2000 or (d >= 200 and d >= 0.02 * p):
        return 1
    return 2 if d >= 50 else 3


# ---- the schedule, ported from phase_for() in election_day.sh (validate.py --selftest diffs it against the bash) -----


def phase_for(d, h, m):
    next_day = ELECTION_DATE + timedelta(days=1)
    if d == next_day:
        if h == RESULTS_END and m == 0:
            return "results-final"
        if h < RESULTS_END:
            if m in (15, 45):
                return "precinct-slow"
            if m % RESULTS_EVERY == 0:
                return "results"
    elif d == ELECTION_DATE:
        if h >= POLLS_CLOSE:
            if m in (15, 45):
                return "precinct-slow"
            if m % RESULTS_EVERY == 0:
                return "results"
        elif h == POLLS_CLOSE - 1 and m == 59:
            return "turnout-final"
        elif h >= TURNOUT_START and m % TURNOUT_EVERY == 0:
            return "turnout"
    return ""


def expected_slots(kind):
    """Every minute the scheduler fires a pull of this kind, in order."""
    start = datetime.combine(ELECTION_DATE, datetime.min.time())
    out = []
    for i in range(24 * 60 + 6 * 60):                      # election day 00:00 through 06:00 the next morning
        t = start + timedelta(minutes=i)
        ph = phase_for(t.date(), t.hour, t.minute)
        if not ph:
            continue
        want = {"turnout": ("turnout", "turnout-final"), "results": ("results", "results-final"), "slow": ("precinct-slow",)}.get(kind)
        if kind == "projections":                          # they ride inside a results slot, at :20 and :50
            if ph == "results" and t.minute in (20, 50):
                out.append(t)
        elif ph in want:
            out.append(t)
    return out


def window(t):
    """'voting' (polls open), 'counting' (polls closed, count running) or 'off', for a local time."""
    open_t = datetime.combine(ELECTION_DATE, datetime.min.time()) + timedelta(hours=TURNOUT_START)
    close_t = datetime.combine(ELECTION_DATE, datetime.min.time()) + timedelta(hours=POLLS_CLOSE)
    end_t = datetime.combine(ELECTION_DATE + timedelta(days=1), datetime.min.time()) + timedelta(hours=RESULTS_END, minutes=10)
    if open_t <= t < close_t:
        return "voting"
    return "counting" if close_t <= t < end_t else "off"


# ---- metrics: a few numbers per pull that the source checks compare with its own history ---------------------------


def metrics_results(snap):
    d = snap.path
    s = j(os.path.join(d, "summary.json")) or {}
    en, pr = s.get("county_enr") or {}, s.get("precincts") or {}
    status = read_csv(os.path.join(d, "county_status.csv"))
    ed = read_csv(os.path.join(d, "ed_turnout.csv"))
    cv = read_csv(os.path.join(d, "contest_votes.csv"))
    cc = read_csv(os.path.join(d, "county_contests.csv"))
    es = read_csv(os.path.join(d, "county_enr_status.csv"))
    raw = os.path.join(d, "raw")
    codes = sorted(fn[len("precinct_"):-len(".csv.gz")] for fn in (os.listdir(raw) if os.path.isdir(raw) else [])
                   if fn.startswith("precinct_") and fn.endswith(".csv.gz"))
    return {
        "few_status_rows": len(status or []), "few_ed_rows": len(ed or []), "few_vote_rows": len(cv or []),
        "few_contests": len({r["contest_id"] for r in (cv or [])}),
        "enr_ok": en.get("counties_ok", 0), "enr_status_rows": len(es or []), "enr_rows": len(cc or []),
        "prec_ok": pr.get("counties_ok", 0), "prec_rows": pr.get("rows", 0),
        "enr_codes": sorted({r["county_code"] for r in (es or [])}),
        "prec_codes": codes,
        "prec_lines": {c: count_rows(os.path.join(raw, f"precinct_{c}.csv.gz")) for c in codes},
        "_enr_failed": sorted((en.get("failures") or {}).keys()),
        "_contests": s.get("contests") or {},
        "_files": {"county_status.csv": status is not None, "ed_turnout.csv": ed is not None, "contest_votes.csv": cv is not None,
                   "county_contests.csv": cc is not None, "county_enr_status.csv": es is not None},
        "_bad_dates": sorted({(r.get("election_date") or "").strip() for r in (es or [])} - GENERAL - {""}),
        "_primary": sorted({r["contest"] for r in (cc or []) if PRIMARY.search(r.get("contest", ""))}
                           | {r["contest"] for r in (cv or []) if PRIMARY.search(r.get("contest", ""))})[:5],
        "_status": {r["county_code"]: [num(r.get("ballots_cast")), r.get("last_updated"), num(r.get("precincts_reporting")),
                                       num(r.get("precincts_total"))] for r in (es or [])},
    }


def metrics_slow(snap):
    d = snap.path
    s = j(os.path.join(d, "summary.json")) or {}
    raw = os.path.join(d, "raw")
    codes = sorted(fn[len("precinct_"):-len(".csv.gz")] for fn in (os.listdir(raw) if os.path.isdir(raw) else [])
                   if fn.startswith("precinct_") and fn.endswith(".csv.gz"))
    return {"ok": s.get("counties_ok", 0), "targeted": s.get("counties_targeted", 0), "rows": s.get("rows", 0),
            "codes": codes, "lines": {c: count_rows(os.path.join(raw, f"precinct_{c}.csv.gz")) for c in codes},
            "_failures": sorted((s.get("failures") or {}).keys())}


def metrics_projections(snap):
    d = snap.path
    s = j(os.path.join(d, "summary.json")) or {}
    dd, ka, pm = (j(os.path.join(d, f"{n}_summary.json")) or {} for n in ("ddhq", "kalshi", "polymarket"))
    src = s.get("sources") or {}
    return {
        "sources_ok": s.get("sources_ok", 0), "sources_tried": s.get("sources_tried", 0),
        "prediction_rows": s.get("prediction_rows", 0), "call_rows": s.get("call_rows", 0),
        "ddhq_discovered": dd.get("races_discovered", 0), "ddhq_ok": dd.get("races_ok", 0),
        "ddhq_forecast": dd.get("races_with_forecast", 0),
        "kalshi_events": ka.get("events_ok", 0), "kalshi_rows": ka.get("rows", 0),
        "polymarket_rows": pm.get("rows", 0), "polymarket_races": pm.get("races", 0),
        "_down": sorted(n for n, v in src.items() if not (v or {}).get("ok")),
        "_errors": {n: (v or {}).get("error") for n, v in src.items() if not (v or {}).get("ok")},
        "_failures": {n: sorted((x.get("failures") or {}).keys()) for n, x in (("ddhq", dd), ("kalshi", ka), ("polymarket", pm))},
        "_empty_series": sorted(ka.get("empty_series") or []),
    }


def metrics_turnout(snap):
    d = snap.path
    man = j(os.path.join(d, "manifest.json")) or {}
    counties = read_csv(os.path.join(d, "data", "counties.csv"))
    prec = read_csv(os.path.join(d, "data", "by_precinct.csv"))
    failed, last, ok_codes = [], {}, []
    try:
        with zipfile.ZipFile(os.path.join(d, "raw_feeds.zip")) as z:
            log = json.loads(z.read("collect_log.json"))
        failed = sorted(r["code"] for r in log if r.get("status") != "ok")
        ok_codes = sorted(r["code"] for r in log if r.get("status") == "ok")
        last = {r["code"]: (r.get("summary") or {}).get("LastUpdatedTime") for r in log}
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        failed = None                                      # no readable collect_log: reported by the check, not guessed
    return {
        "counties": len(counties or []), "precinct_rows": len(prec or []),
        "county_codes": sorted({r["code"] for r in (counties or [])}), "ok_codes": ok_codes,
        "_failed": failed, "_last_updated": last, "_feed_time": man.get("feed_time"),
        "_broward_files": os.path.isdir(os.path.join(d, "data", "broward")) and bool(os.listdir(os.path.join(d, "data", "broward"))),
        "_files": {"counties.csv": counties is not None, "by_precinct.csv": prec is not None},
    }


METRICS = {"results": metrics_results, "slow": metrics_slow, "projections": metrics_projections, "turnout": metrics_turnout}


def fold(base, m):
    """Fold one pull's metrics into the high-water marks: numbers keep their max, lists grow into a union, dicts keep per-key maxima."""
    for k, v in m.items():
        if k.startswith("_"):
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float, list, dict)):
            continue
        if isinstance(v, (int, float)):
            base[k] = max(base.get(k, 0), v)
        elif isinstance(v, list):
            base[k] = sorted(set(base.get(k, [])) | set(v))
        else:
            cur = base.setdefault(k, {})
            for kk, vv in v.items():
                if isinstance(vv, (int, float)):
                    cur[kk] = max(cur.get(kk, 0), vv)
    return base


# ---- SOURCE checks -----------------------------------------------------------------------------------------------


def _S(kind, tier, scope, headline, detail="", mode="condition", **kw):
    return finding("source", kind, tier, mode, scope, headline, detail, **kw)


def _short_tier(cur, base, hard=0.75):
    """Tier for 'we got cur of the base we usually get': T1 if it is mostly gone, else T2."""
    return 1 if base and cur < hard * base else 2


def source_pull_gap(snap, prev_snap):
    """Between this pull and the last one, did the scheduler skip a slot? An event, once per gap, inside the schedule only.

    Each pull answers the latest slot at or before it. Slots strictly between the two answered ones had no pull.
    Pulls from before the schedule starts (the test pulls) answer no slot, so they never count as a gap."""
    slots = expected_slots(snap.kind)
    if prev_snap is None or not slots:
        return []
    slack = timedelta(seconds=5)

    def answered(t):
        due = [s for s in slots if s <= t + slack]
        return due[-1] if due and t >= slots[0] - timedelta(seconds=90) else None

    sa, sb = answered(prev_snap.t), answered(snap.t)
    if sa is None or sb is None:
        return []
    missed = [s for s in slots if sa < s < sb]
    if not missed:
        return []
    when = ", ".join(s.strftime("%H:%M") for s in missed[:6])
    return [_S("pull_gap", 1 if len(missed) >= 3 else 2, f"{snap.kind}|{snap.id}", f"{pl(len(missed), 'scheduled ' + snap.kind + ' pull')} never ran",
               f"between {prev_snap.t:%H:%M} and {snap.t:%H:%M}; due at {when}. The scheduler may have been busy or stopped.", mode="event", count=len(missed))]


def source_results(snap, m, hwm, ever, prev, state):
    out = []
    S = "results"
    # --- Florida Election Watch tables
    for key, fname, label in (("few_status_rows", "county_status.csv", "county status"), ("few_ed_rows", "ed_turnout.csv", "Election Day turnout"),
                              ("few_vote_rows", "contest_votes.csv", "statewide contest votes")):
        cur, base = m[key], hwm.get(key, 0)
        if not m["_files"].get(fname):
            out.append(_S("table_missing", 1, f"FEW|{fname}", f"Florida Election Watch {label}: no file this pull",
                          f"{fname} was not written (it had {f(base)} rows before). The state site may be down or have changed.", curr=0, prev=base))
        elif base and cur == 0:
            out.append(_S("table_missing", 1, f"FEW|{fname}", f"Florida Election Watch {label}: the table came back empty",
                          f"{fname} has no rows (it had {f(base)} before).", curr=0, prev=base))
        elif cur < base:
            out.append(_S("table_short", _short_tier(cur, base), f"FEW|{fname}", f"Florida Election Watch {label}: {f(cur)} rows, usually {f(base)}",
                          f"{fname} is short by {f(base - cur)} rows.", curr=cur, prev=base, delta=cur - base))
    # --- contests the state site is serving
    if m["few_contests"] < hwm.get("few_contests", 0):
        base = hwm["few_contests"]
        gone = sorted(set((prev or {}).get("_contests", {}).values()) - set(m["_contests"].values()))
        out.append(_S("contests_short", _short_tier(m["few_contests"], base), "FEW|contests", f"Florida Election Watch served {m['few_contests']} contests, usually {base}",
                      "missing: " + (", ".join(short(x, 50) for x in gone[:5]) + (f" and {len(gone) - 5} more" if len(gone) > 5 else "") if gone else "see the pull's summary.json"),
                      curr=m["few_contests"], prev=base, delta=m["few_contests"] - base))
    # --- county ENR sites (Clarity)
    failed = set(m["_enr_failed"])
    configured = max(len(m["enr_codes"]), len(ever.get("enr_codes", [])), 1)
    if m["enr_ok"] == 0 and hwm.get("enr_ok", 0) > 0:
        out.append(_S("county_sites_failed", 1, "ENR|all", "No county results site could be read this pull", f"0 of {configured} counties (it was {hwm['enr_ok']}).", curr=0, prev=hwm["enr_ok"]))
    elif len(failed) >= max(10, 0.25 * configured):
        out.append(_S("county_sites_failed", 1, "ENR|all", f"{len(failed)} of {configured} county results sites failed",
                      "failing: " + ", ".join(sorted(failed)[:12]) + ("…" if len(failed) > 12 else ""), count=len(failed), curr=m["enr_ok"], prev=hwm.get("enr_ok", 0)))
    else:
        for c in sorted(failed):
            out.append(_S("county_site_failed", 2, f"ENR|{c}", f"County results site failed: {c}", "county_enr_summary.json lists it under failures.", count=1))
    if not failed and m["enr_ok"] < hwm.get("enr_ok", 0):
        out.append(_S("county_sites_short", 2, "ENR|count", f"County results sites read: {m['enr_ok']}, usually {hwm['enr_ok']}", "no county is named in failures; one may have been dropped from the config.",
                      curr=m["enr_ok"], prev=hwm["enr_ok"], delta=m["enr_ok"] - hwm["enr_ok"]))
    if m["enr_status_rows"] < hwm.get("enr_status_rows", 0):
        out.append(_S("status_short", 2, "ENR|status", f"County status table has {m['enr_status_rows']} counties, usually {hwm['enr_status_rows']}", "",
                      curr=m["enr_status_rows"], prev=hwm["enr_status_rows"], delta=m["enr_status_rows"] - hwm["enr_status_rows"]))
    # --- precinct files: a county that had one and no longer does. Counties that never had one are the slow path's job.
    lost = sorted(set(ever.get("prec_codes", [])) - set(m["prec_codes"]))
    if len(lost) >= 10:
        out.append(_S("precinct_files_lost", 1, "PREC|all", f"{len(lost)} counties' precinct files are missing this pull", ", ".join(lost[:12]) + ("…" if len(lost) > 12 else ""), count=len(lost)))
    else:
        for c in lost:
            out.append(_S("precinct_file_lost", 2, f"PREC|{c}", f"Precinct file missing for {c}", "this county has produced one before.", count=1))
    for c, n in sorted(m["prec_lines"].items()):
        base = (hwm.get("prec_lines") or {}).get(c, 0)
        if n == -1:
            out.append(_S("precinct_file_corrupt", 2, f"PREC|{c}", f"Precinct file for {c} cannot be read", "the download is truncated or corrupt.", count=1))
        elif base and n < 0.9 * base:
            out.append(_S("precinct_file_short", 2, f"PREC|{c}", f"Precinct file for {c} has {f(n)} rows, usually {f(base)}", "a truncated file loses whole precincts.", curr=n, prev=base, delta=n - base))
    # --- the wrong election
    if m["_bad_dates"]:
        out.append(_S("wrong_election", 1, "ENR|dates", "A county results page is not for the 2026 general", "election date found: " + ", ".join(m["_bad_dates"]), count=len(m["_bad_dates"])))
    if m["_primary"]:
        out.append(_S("wrong_election", 1, "ENR|primary", "Primary-election contests are in the results", "e.g. " + "; ".join(short(x, 50) for x in m["_primary"][:3]), count=len(m["_primary"])))
    # --- counties that stopped moving while still counting (only once polls have closed)
    out += source_stale(snap, m, state)
    return out


def source_stale(snap, m, state):
    """A county site whose numbers and timestamp have not moved for several pulls while precincts are still out."""
    out = []
    if window(snap.t) != "counting":
        state["stale"] = {}
        return out
    streaks = state.setdefault("stale", {})
    for c, (ballots, stamp, rep, tot) in m["_status"].items():
        sig = [ballots, stamp, rep]
        done = tot and rep is not None and rep >= tot
        started = bool(ballots) or bool(rep)               # a county that has not begun reporting looks identical every pull: that is normal
        st = streaks.get(c)
        if st and st["sig"] == sig and not done and started:
            st["n"] += 1
        else:
            streaks[c] = {"sig": sig, "n": 0}
        n = streaks[c]["n"]
        if n >= 3 and not done:
            out.append(_S("county_stalled", 2 if n >= 6 else 3, f"ENR|stalled|{c}", f"{c} has not updated in {n} pulls ({n * 10} min)",
                          f"{rep}/{tot} precincts in, last update {stamp}.", count=n))
    return out


def source_slow(snap, m, hwm, ever, prev):
    out = []
    if m["ok"] == 0 and hwm.get("ok", 0) > 0:
        out.append(_S("slow_all_failed", 1, "SLOW|all", "The slow precinct pull read no county", f"0 of {m['targeted']} counties (it was {hwm['ok']}).", curr=0, prev=hwm["ok"]))
    elif m["ok"] < hwm.get("ok", 0):
        lost = sorted(set(ever.get("codes", [])) - set(m["codes"]))
        out.append(_S("slow_short", _short_tier(m["ok"], hwm["ok"], 0.5), "SLOW|count", f"Slow precinct pull read {m['ok']} counties, usually {hwm['ok']}",
                      "missing: " + ", ".join(lost[:12]) if lost else "", curr=m["ok"], prev=hwm["ok"], delta=m["ok"] - hwm["ok"]))
    for c, n in sorted(m["lines"].items()):
        base = (hwm.get("lines") or {}).get(c, 0)
        if n == -1:
            out.append(_S("precinct_file_corrupt", 2, f"SLOW|{c}", f"Slow precinct file for {c} cannot be read", "truncated or corrupt.", count=1))
        elif base and n < 0.9 * base:
            out.append(_S("precinct_file_short", 2, f"SLOW|{c}", f"Slow precinct file for {c} has {f(n)} rows, usually {f(base)}", "", curr=n, prev=base, delta=n - base))
    if m["rows"] == 0 and hwm.get("rows", 0) > 0:
        out.append(_S("slow_all_failed", 1, "SLOW|rows", "The slow precinct pull wrote no rows", f"it was {f(hwm['rows'])}.", curr=0, prev=hwm["rows"]))
    return out


def source_projections(snap, m, hwm, ever, prev):
    out = []
    for name in m["_down"]:
        err = m["_errors"].get(name) or "no detail"
        tier = 1 if name == "ddhq" else 2                       # DDHQ is the only authority for race calls
        out.append(_S("source_down", tier, f"PROJ|{name}", f"{name.upper() if name == 'ddhq' else name.title()} failed this pull",
                      f"{err}. " + ("No race calls or forecasts this pull." if name == "ddhq" else "Market prices are missing this pull."), count=1))
    if "ddhq" not in m["_down"]:
        if m["ddhq_ok"] < m["ddhq_discovered"]:
            out.append(_S("race_pages_failed", 2, "PROJ|ddhq|pages", f"DDHQ: {pl(m['ddhq_discovered'] - m['ddhq_ok'], 'race page')} failed",
                          "failing: " + ", ".join(m["_failures"].get("ddhq", [])[:8]), curr=m["ddhq_ok"], prev=m["ddhq_discovered"]))
        if m["ddhq_discovered"] < hwm.get("ddhq_discovered", 0):
            out.append(_S("races_short", 2, "PROJ|ddhq|races", f"DDHQ lists {m['ddhq_discovered']} races, usually {hwm['ddhq_discovered']}", "a race page may have been removed.",
                          curr=m["ddhq_discovered"], prev=hwm["ddhq_discovered"], delta=m["ddhq_discovered"] - hwm["ddhq_discovered"]))
        if m["ddhq_forecast"] < hwm.get("ddhq_forecast", 0) and m["ddhq_ok"] >= m["ddhq_discovered"]:
            out.append(_S("forecasts_short", 3, "PROJ|ddhq|forecast", f"DDHQ has a forecast for {m['ddhq_forecast']} races, usually {hwm['ddhq_forecast']}", "",
                          curr=m["ddhq_forecast"], prev=hwm["ddhq_forecast"], delta=m["ddhq_forecast"] - hwm["ddhq_forecast"]))
    if "kalshi" not in m["_down"] and m["kalshi_events"] < hwm.get("kalshi_events", 0):
        out.append(_S("markets_short", 2, "PROJ|kalshi|events", f"Kalshi: {m['kalshi_events']} markets read, usually {hwm['kalshi_events']}", "",
                      curr=m["kalshi_events"], prev=hwm["kalshi_events"], delta=m["kalshi_events"] - hwm["kalshi_events"]))
    if "polymarket" not in m["_down"] and m["polymarket_rows"] < hwm.get("polymarket_rows", 0):
        out.append(_S("markets_short", 3, "PROJ|polymarket|rows", f"Polymarket: {m['polymarket_rows']} prices, usually {hwm['polymarket_rows']}", "a market may have closed.",
                      curr=m["polymarket_rows"], prev=hwm["polymarket_rows"], delta=m["polymarket_rows"] - hwm["polymarket_rows"]))
    for name, keys in m["_failures"].items():
        if keys:
            out.append(_S("source_partial", 2, f"PROJ|{name}|failures", f"{name}: {pl(len(keys), 'item')} failed", ", ".join(keys[:8]), count=len(keys)))
    new_empty = sorted(set(m["_empty_series"]) - set((prev or {}).get("_empty_series", m["_empty_series"])))
    if new_empty:
        out.append(_S("markets_closed", 3, "PROJ|kalshi|empty", "Kalshi markets went empty", ", ".join(new_empty), mode="event", count=len(new_empty)))
    return out


def source_turnout(snap, m, hwm, ever, prev):
    out = []
    t = snap.t
    if not m["_files"].get("counties.csv"):
        out.append(_S("table_missing", 1, "TQV|counties", "The turnout run has no county table", "data/counties.csv was not archived."))
    base = hwm.get("counties", 0)
    if m["counties"] < base:
        lost = sorted(set(ever.get("county_codes", [])) - set(m["county_codes"]))
        out.append(_S("counties_short", _short_tier(m["counties"], base, 0.9), "TQV|counties", f"Turnout feed covers {m['counties']} counties, usually {base}",
                      "missing: " + ", ".join(lost[:12]), curr=m["counties"], prev=base, delta=m["counties"] - base))
    if m["_failed"] is None:
        out.append(_S("collect_log_missing", 2, "TQV|collect_log", "This run archived no readable county feed log", "raw_feeds.zip has no collect_log.json."))
    else:
        # a county that never had a feed (Broward has its own dashboard) is structure; one that had a feed and lost it is news
        lost = sorted(c for c in m["_failed"] if c in set(ever.get("ok_codes", [])))
        if lost:
            out.append(_S("county_feeds_failed", 1 if len(lost) >= 10 else 2, "TQV|feeds", f"{pl(len(lost), 'county turnout feed')} failed", ", ".join(lost[:12]), count=len(lost)))
    if m["precinct_rows"] < 0.97 * hwm.get("precinct_rows", 0):
        out.append(_S("precincts_short", 2, "TQV|precincts", f"Precinct turnout table has {f(m['precinct_rows'])} rows, usually {f(hwm['precinct_rows'])}", "a county dropped out of the precinct data.",
                      curr=m["precinct_rows"], prev=hwm["precinct_rows"], delta=m["precinct_rows"] - hwm["precinct_rows"]))
    if "voting" == window(t):
        opened = datetime.combine(ELECTION_DATE, datetime.min.time()) + timedelta(hours=TURNOUT_START)
        # feeds are expected to move while the polls are open
        try:
            ft = datetime.fromisoformat(m["_feed_time"].replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
            lag = (t - max(ft, opened)).total_seconds() / 60       # a feed last touched the evening before has had nothing to report until polls open
            if lag > 60:
                out.append(_S("feed_stale", 1 if lag > 240 else 2 if lag > 120 else 3, "TQV|feed", f"Newest county feed is {int(lag)} minutes old",
                              f"newest LastUpdatedTime {ft:%H:%M}, pulled {t:%H:%M}.", curr=int(lag)))
        except (AttributeError, ValueError, TypeError):
            pass
        old = []
        for c, stamp in m["_last_updated"].items():
            try:
                age = (t - max(datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone().replace(tzinfo=None), opened)).total_seconds() / 3600
                if age > 3:
                    old.append(c)
            except (AttributeError, ValueError, TypeError):
                pass
        if old:
            out.append(_S("counties_stale", 2 if len(old) > 15 else 3, "TQV|stale", f"{pl(len(old), 'county feed')} not updated in 3+ hours", ", ".join(sorted(old)[:12]), count=len(old)))
    if not m["_broward_files"] and (prev or {}).get("_broward_files", True):
        out.append(_S("broward_missing", 2, "TQV|broward", "No Broward dashboard files in this run", "data/broward/ is empty; Broward is on its own feed."))
    return out


def source_checks(kind, snap, m, hwm, ever, prev, prev_snap, state):
    """Everything the source validator asks of one pull. m = this pull's metrics, hwm/ever = history, prev = last pull's metrics."""
    fn = {"results": lambda: source_results(snap, m, hwm, ever, prev, state), "slow": lambda: source_slow(snap, m, hwm, ever, prev),
          "projections": lambda: source_projections(snap, m, hwm, ever, prev), "turnout": lambda: source_turnout(snap, m, hwm, ever, prev)}[kind]
    return fn() + source_pull_gap(snap, prev_snap)
