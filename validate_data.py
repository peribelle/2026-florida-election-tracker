#!/usr/bin/env python3
"""The DATA validator's checks: does the data make sense?

Every table the pipeline saves goes through one comparer (table_events), so "any race, any number" is one rule applied
everywhere, not a list of special cases:

  * a count that went DOWN between two pulls            -> votes_down / ballots_down   (tier by size)
  * a part that went down while its total did not      -> parts_down                   (T3: ballots reclassified)
  * a number that became blank                         -> value_blanked                (T2)
  * a row that vanished                                 -> rows_missing                 (tier by the votes it carried)
  * half of a table vanishing at once                   -> shape_changed                (T1: the feed changed, not the count)
  * new rows                                            -> rows_new                     (T3: counties coming online)

Findings are grouped (per race and county, per county for precincts) so one bad county is one alert; every row-level
finding is still kept in finding["rows"]. Above FLOOD groups a table collapses to one alert per source, never a pile.

Invariants are checked inside one pull and are conditions (they stay open until fixed): nothing negative, totals add up
to their parts, a candidate cannot have more votes than the county has ballots, probabilities stay in [0, 1].
"""
import os
from collections import defaultdict

from validate_checks import (ballot_tier, f, finding, j, MASS_FRACTION, MIN_FOR_MASS, num, pl, read_csv, read_gz_csv, short, vote_tier)

FLOOD = 25                       # more groups than this from one table collapse to one per source
EXAMPLES = 3


def _D(kind, tier, mode, scope, headline, detail="", **kw):
    return finding("data", kind, tier, mode, scope, headline, detail, **kw)


def _tbl(rows, keycols, valcols):
    t, ex = {}, {}
    for r in rows:
        k = tuple((r.get(c) or "").strip() for c in keycols)
        v = {c: num(r.get(c)) for c in valcols}
        if k in t:                                         # a repeated key is a feed that splits a line; add it up
            for c in valcols:
                if v[c] is not None:
                    t[k][c] = (t[k][c] or 0) + v[c]
        else:
            t[k], ex[k] = v, r
    return t, ex


def table_events(old, new, *, keycols, valcols, main, group_by, title, who, src, tier_fn=vote_tier, unit="votes", bump=None, report_new=True):
    """Compare two versions of one table. See the module docstring for what comes out."""
    P, exp = _tbl(old, keycols, valcols)
    C, ex = _tbl(new, keycols, valcols)
    for k, r in exp.items():                               # rows that only existed before still need a name for the message
        ex.setdefault(k, r)
    gi = [keycols.index(c) for c in group_by]

    def grp(k):
        return tuple(k[i] for i in gi)

    drops, parts, blanks, missing = [], [], [], []
    for k, pv in P.items():
        cv = C.get(k)
        if cv is None:
            missing.append(k)
            continue
        for col in valcols:
            a, b = pv[col], cv[col]
            if a is None:
                continue
            if b is None:
                if not a:                                  # a zero placeholder turning blank loses nothing
                    continue
                pm, cm = pv.get(main), cv.get(main)
                if col != main and pm is not None and cm is not None and cm >= pm:
                    parts.append((k, col, a, None))        # the county stopped publishing the breakdown but the total held: not lost votes
                else:
                    blanks.append((k, col, a, None))
            elif b < a:
                (drops if col == main else parts).append((k, col, a, b))
    dropped = {k for k, *_ in drops}
    parts = [p for p in parts if p[0] not in dropped]
    added = [k for k in C if k not in P]
    out = []

    def label(g, k):
        return title(g, ex[k])

    def rowsof(items):
        return [{"key": " | ".join(k), "column": col, "prev": a, "curr": b, "delta": (None if b is None else b - a)} for k, col, a, b in items]

    def emit(items, kind, tier_of, mode_tier=None):
        groups = defaultdict(list)
        for it in items:
            groups[grp(it[0])].append(it)
        collapsed = len(groups) > FLOOD
        if collapsed:
            groups = {(): [it for lst in groups.values() for it in lst]}
        for g, its in groups.items():
            tiers = [tier_of(a, b if b is not None else 0) for _, _, a, b in its]
            tier = min(tiers)
            lost = sum(a - (b or 0) for _, _, a, b in its)
            if kind != "parts_down" and len(its) >= 10 and tier > 2 and lost >= (50 if unit == "ballots" else 10):
                tier = 2                                    # a pile of small losses in one place is a warning once they add up to something
            if bump and not collapsed:
                tier = bump(g, tier)
            worst = max(its, key=lambda it: it[2] - (it[3] or 0))
            wk, wcol, wa, wb = worst
            where = src if collapsed else f"{src}|{'|'.join(g)}"
            head_where = f"{src} (all counties, {len(its)} rows)" if collapsed else label(g, wk)
            ex_txt = "; ".join(f"{short(who(ex[k]), 38)} {f(a)} → {f(b) if b is not None else 'blank'}" for k, _, a, b in
                               sorted(its, key=lambda it: -(it[2] - (it[3] or 0)))[:EXAMPLES])
            out.append(_D(kind, tier, "event", where, KIND_HEAD[kind](head_where, len(its), lost, unit), ex_txt + (f"; and {len(its) - EXAMPLES} more" if len(its) > EXAMPLES else ""),
                          prev=wa, curr=wb, delta=-lost, count=len(its), rows=rowsof(its)))

    emit([d for d in drops], f"{unit}_down", tier_fn)
    emit(parts, "parts_down", lambda a, b: 3)
    emit(blanks, "value_blanked", lambda a, b: 2)
    # rows whose key changed while the numbers carried over are a re-keyed table, not lost votes
    mg, ag = defaultdict(list), defaultdict(list)
    for k in missing:
        mg[grp(k)].append(k)
    for k in added:
        ag[grp(k)].append(k)
    gone_keys, came_keys = set(), set()
    for g in set(mg) & set(ag):
        lost, gained = sum(P[k][main] or 0 for k in mg[g]), sum(C[k][main] or 0 for k in ag[g])
        same = abs(gained - lost) <= max(2, 0.001 * lost) if lost else (not gained and len(mg[g]) == len(ag[g]))
        if same:
            gone_keys.update(mg[g])
            came_keys.update(ag[g])
    if gone_keys:
        missing = [k for k in missing if k not in gone_keys]
        added = [k for k in added if k not in came_keys]
        out.append(_D("rows_rekeyed", 3, "event", f"{src}|rekeyed", f"{src}: {pl(len(gone_keys), 'row')} got new keys; the numbers carried over",
                      "e.g. " + "; ".join(short(who(ex[k]), 38) for k in sorted(gone_keys)[:EXAMPLES]), count=len(gone_keys),
                      rows=[{"key": " | ".join(k), "column": "(row)", "prev": P[k][main], "curr": None, "delta": None} for k in sorted(gone_keys)]))
    # vanished rows
    mass = len(P) >= MIN_FOR_MASS and len(missing) >= MASS_FRACTION * len(P)
    if mass:
        carried = sum((P[k][main] or 0) for k in missing)
        out.append(_D("shape_changed", 1 if carried else 3, "event", f"{src}|shape", f"{src}: {len(missing)} of {len(P)} rows vanished at once" + ("" if carried else ", carrying no votes"),
                      "half the table is gone in one pull: the feed changed shape, or a county reloaded under new names." if carried else
                      "the rows held no votes (placeholders a county dropped when it reloaded its file), so nothing was lost.", count=len(missing),
                      rows=[{"key": " | ".join(k), "column": "(row)", "prev": P[k][main], "curr": None, "delta": None} for k in missing]))
    elif missing:
        groups = defaultdict(list)
        for k in missing:
            groups[grp(k)].append(k)
        collapsed = len(groups) > FLOOD
        if collapsed:
            groups = {(): missing}
        for g, ks in groups.items():
            lost = sum((P[k][main] or 0) for k in ks)
            tier = tier_fn(lost, 0) if lost else 3          # rows that carried nothing (pre-count placeholders) are a notice
            where = src if collapsed else f"{src}|{'|'.join(g)}"
            who_txt = f"{src} ({len(ks)} rows)" if collapsed else label(g, ks[0])
            out.append(_D("rows_missing", tier, "event", where, f"Rows disappeared from {who_txt}: {len(ks)} gone, carrying {f(lost)} {unit}",
                          "; ".join(short(who(ex[k]), 38) for k in ks[:EXAMPLES]), prev=lost, curr=0, delta=-lost, count=len(ks),
                          rows=[{"key": " | ".join(k), "column": "(row)", "prev": P[k][main], "curr": None, "delta": None} for k in ks]))
    if added and report_new:                               # one notice per table: counties coming online is the normal way for rows to appear
        places = {grp(k)[0] if grp(k) else "" for k in added}
        out.append(_D("rows_new", 3, "event", f"{src}|new", f"New in {src}: {pl(len(added), 'row')} across {pl(len(places), 'place')}",
                      "e.g. " + "; ".join(short(who(ex[k]), 38) for k in added[:EXAMPLES]), count=len(added),
                      rows=[{"key": " | ".join(k), "column": "(row)", "prev": None, "curr": C[k][main], "delta": None} for k in added]))
    return out


KIND_HEAD = {
    "votes_down": lambda where, n, lost, unit: f"Votes dropped in {where}: −{f(lost)}" + (f" across {n} numbers" if n > 1 else ""),
    "ballots_down": lambda where, n, lost, unit: f"Ballots dropped in {where}: −{f(lost)}" + (f" across {n} numbers" if n > 1 else ""),
    "parts_down": lambda where, n, lost, unit: f"A part fell while its total held in {where}: −{f(lost)}" + (f" across {n} numbers" if n > 1 else ""),
    "value_blanked": lambda where, n, lost, unit: f"Numbers went blank in {where}: {n} (were {f(lost)} in all)",
}


def field_events(old, new, keycol, rules, *, src, label):
    """Row-per-key tables (county status and the like). rules: {col: ('down' | 'moved', tier_fn, kind, noun)}."""
    P = {(r.get(keycol) or "").strip(): r for r in old}
    out = []
    for r in new:
        key = (r.get(keycol) or "").strip()
        pr = P.get(key)
        if pr is None or key.upper() in ("TOTAL", "TOTALS"):
            continue
        for col, (mode, fn, kind, noun) in rules.items():
            a, b = num(pr.get(col)), num(r.get(col))
            if a is None:
                continue
            if b is None:
                out.append(_D("value_blanked", 2, "event", f"{src}|{key}|{col}", f"{label(key)}: {noun} went blank (was {f(a)})", prev=a, curr=None,
                              rows=[{"key": key, "column": col, "prev": a, "curr": None, "delta": None}]))
            elif (mode == "down" and b < a) or (mode == "moved" and b != a):
                tier = fn(a, b)
                if not tier:                                # the rule says this change is noise
                    continue
                out.append(_D(kind, tier, "event", f"{src}|{key}|{col}", f"{label(key)}: {noun} {f(a)} → {f(b)} ({b - a:+,})", prev=a, curr=b, delta=b - a,
                              rows=[{"key": key, "column": col, "prev": a, "curr": b, "delta": b - a}]))
    return collapse(out, src)


def collapse(findings, src, limit=15):
    """More than `limit` findings of one kind from one table become one (its rows keep every detail)."""
    by = defaultdict(list)
    for fd in findings:
        by[(fd["kind"], fd["scope"].split("|")[-1])].append(fd)
    out = []
    for (kind, col), fs in by.items():
        if len(fs) <= limit:
            out += fs
            continue
        out.append(_D(kind, min(x["tier"] for x in fs), "event", f"{src}|all|{col}", f"{src}: {len(fs)} counties changed on '{col}'",
                      "; ".join(x["headline"] for x in fs[:EXAMPLES]), count=len(fs), rows=[r for x in fs for r in x["rows"]]))
    return out


def _moved_pct(frac_t2, noise=0.0002):
    """Tier for a denominator that moved. A few voters on the rolls (under 3, or 0.02%) is upkeep, not news, so tier 0 = no flag."""
    def fn(a, b):
        d = abs(b - a)
        if d < max(3, noise * (a or 0)):
            return 0
        return 2 if a and d / a >= frac_t2 else 3
    return fn


def _precinct_tier(a, b):
    return vote_tier(a, b)


# ---- results ---------------------------------------------------------------------------------------------------------


def data_results(snap, prev, first):
    out = []
    d, p = snap.path, (prev.path if prev else None)
    cv = read_csv(os.path.join(d, "contest_votes.csv"))
    cc = read_csv(os.path.join(d, "county_contests.csv"))
    es = read_csv(os.path.join(d, "county_enr_status.csv"))
    st = read_csv(os.path.join(d, "county_status.csv"))
    ed = read_csv(os.path.join(d, "ed_turnout.csv"))
    # ---- invariants
    if cv:
        out += inv_few_votes(cv)
    if cc:
        out += inv_county_contests(cc, es or [])
    # ---- changes since the last pull
    if first or not prev:
        return out
    ocv, occ = read_csv(os.path.join(p, "contest_votes.csv")), read_csv(os.path.join(p, "county_contests.csv"))
    oes, ost, oed = (read_csv(os.path.join(p, n)) for n in ("county_enr_status.csv", "county_status.csv", "ed_turnout.csv"))
    if cv is not None and ocv is not None:
        titles = {r["contest_id"]: r["contest"] for r in cv + ocv}
        out += table_events(ocv, cv, keycols=("contest_id", "county", "candidate", "party"), valcols=("votes",), main="votes", group_by=("contest_id", "county"),
                            title=lambda g, r: f"{short(titles.get(g[0], g[0]), 55)} · {'statewide' if g[1].upper() in ('TOTAL', 'TOTALS') else g[1]}",
                            who=lambda r: r.get("candidate", ""), src="FEW",
                            bump=lambda g, t: min(t, 2) if g[1].upper() in ("TOTAL", "TOTALS") else t)
    if cc is not None and occ is not None:
        out += table_events(occ, cc, keycols=("county_code", "contest", "candidate", "party"), valcols=("total", "early", "mail", "election_day", "provisional"),
                            main="total", group_by=("county_code", "contest"), title=lambda g, r: f"{short(g[1], 55)} · {g[0]}", who=lambda r: r.get("candidate", ""), src="ENR")
    if es is not None and oes is not None:
        out += field_events(oes, es, "county_code", {
            "ballots_cast": ("down", vote_tier, "votes_down", "ballots cast"),
            "precincts_reporting": ("down", lambda a, b: 1 if a - b >= 5 else 2, "precincts_regressed", "precincts reporting"),
            "precincts_total": ("moved", lambda a, b: 2, "count_changed", "precincts in the county"),
            "registered": ("moved", _moved_pct(0.005), "count_changed", "registered voters")}, src="ENR-status", label=lambda k: k)
    if st is not None and ost is not None:
        out += field_events(ost, st, "county", {
            "voter_turnout": ("down", vote_tier, "votes_down", "ballots counted"),
            "eligible_active": ("moved", _moved_pct(0.005), "count_changed", "active registered voters"),
            "precincts_reporting_pct": ("down", lambda a, b: 2, "precincts_regressed", "precincts reporting %"),
            "precincts_completed_pct": ("down", lambda a, b: 2, "precincts_regressed", "precincts completed %"),
            "vbm_completed": ("down", vote_tier, "votes_down", "vote-by-mail counted"),
            "early_completed": ("down", vote_tier, "votes_down", "early votes counted"),
            "provisional_completed": ("down", vote_tier, "votes_down", "provisional counted")}, src="FEW-status", label=lambda k: k)
    if ed is not None and oed is not None:
        out += field_events(oed, ed, "county", {"turnout": ("down", vote_tier, "votes_down", "Election Day turnout")}, src="FEW-ED", label=lambda k: k)
    out += precinct_events(snap, prev, "PREC", "raw")
    return out


def precinct_events(snap, prev, src, rawdir):
    """Precinct files, county by county: votes that fell, precincts that vanished."""
    out = []
    rd, rp = os.path.join(snap.path, rawdir), os.path.join(prev.path, rawdir)
    if not os.path.isdir(rd) or not os.path.isdir(rp):
        return out
    codes = sorted(fn[len("precinct_"):-len(".csv.gz")] for fn in os.listdir(rd) if fn.startswith("precinct_") and fn.endswith(".csv.gz"))
    for c in codes:
        try:
            new = read_gz_csv(os.path.join(rd, f"precinct_{c}.csv.gz"))
            old = read_gz_csv(os.path.join(rp, f"precinct_{c}.csv.gz"))
        except (OSError, EOFError):
            continue                                       # unreadable files are the source validator's finding
        if not new or not old:
            continue
        out += table_events(old, new, keycols=("Contest", "Candidate Issue", "Party", "Precinct Name"),
                            valcols=("Total Votes", "Mail Votes", "Early Votes", "Election Day Votes", "Provisional Votes"), main="Total Votes",
                            group_by=("Contest",), title=lambda g, r, c=c: f"{c} precincts · {short(g[0], 50)}", who=lambda r: f"{r.get('Precinct Name', '')} {r.get('Candidate Issue', '')}",
                            src=f"{src}|{c}", tier_fn=_precinct_tier)
    return out


def inv_few_votes(rows):
    out = []
    neg = [r for r in rows if (num(r.get("votes")) or 0) < 0]
    if neg:
        out.append(_D("negative_value", 1, "condition", "FEW|negative", f"Negative vote counts on the state site: {pl(len(neg), 'row')}",
                      "; ".join(f"{short(r['candidate'], 30)} in {r['county']}: {r['votes']}" for r in neg[:EXAMPLES]), count=len(neg),
                      rows=[{"key": f"{r['contest_id']} | {r['county']} | {r['candidate']}", "column": "votes", "prev": None, "curr": num(r["votes"]), "delta": None} for r in neg]))
    sums, totals, title = defaultdict(int), {}, {}
    for r in rows:
        v = num(r.get("votes"))
        if v is None:
            continue
        k = (r["contest_id"], r["candidate"], r["party"])
        title[r["contest_id"]] = r["contest"]
        if r["county"].strip().upper() in ("TOTAL", "TOTALS", "STATEWIDE"):
            totals[k] = v
        else:
            sums[k] += v
    bad = [(k, totals[k], sums[k]) for k in totals if abs(totals[k] - sums[k]) > max(2, 0.001 * totals[k])]
    by = defaultdict(list)
    for k, t, s in bad:
        by[k[0]].append((k, t, s))
    for cid, items in by.items():
        out.append(_D("total_mismatch", 2, "condition", f"FEW|total|{cid}", f"Statewide total does not equal the county sum: {short(title[cid], 55)}",
                      "; ".join(f"{short(k[1], 30)} total {f(t)} vs counties {f(s)}" for k, t, s in items[:EXAMPLES]), count=len(items),
                      rows=[{"key": f"{k[0]} | {k[1]}", "column": "votes", "prev": s, "curr": t, "delta": t - s} for k, t, s in items]))
    return out


def inv_county_contests(rows, status):
    out = []
    ballots = {r["county_code"]: num(r.get("ballots_cast")) for r in status}
    neg, parts, pct = defaultdict(list), defaultdict(list), defaultdict(list)
    over = defaultdict(list)
    by_contest, psum = defaultdict(int), defaultdict(float)
    for r in rows:
        by_contest[(r["county_code"], r["contest"])] += num(r.get("total")) or 0
        psum[(r["county_code"], r["contest"])] += num(r.get("pct")) or 0
    for r in rows:
        cols = {c: num(r.get(c)) for c in ("election_day", "early", "mail", "provisional", "total")}
        code = r["county_code"]
        if any(v is not None and v < 0 for v in cols.values()):
            neg[code].append(r)
        if all(v is not None for v in cols.values()) and cols["total"] != cols["election_day"] + cols["early"] + cols["mail"] + cols["provisional"] \
                and (cols["election_day"] or cols["early"] or cols["mail"] or cols["provisional"]):    # a county that publishes only a total ("-" for every part) has no breakdown to check
            parts[code].append(r)
        s = by_contest[(code, r["contest"])]
        rep = num(r.get("pct"))
        ps = psum[(code, r["contest"])]
        multi = ps > 150 and abs(ps / 100 - round(ps / 100)) < 0.03        # vote-for-N contests: percents are shares of ballots and sum to N x 100
        if s > 0 and not multi and rep is not None and cols["total"] is not None and abs(100 * cols["total"] / s - rep) > (0.51 if rep == int(rep) else 0.06):     # some counties publish whole-number percents
            pct[code].append(r)
        b = ballots.get(code)
        if b is not None and cols["total"] is not None and cols["total"] > b + max(5, 0.001 * b):
            over[code].append(r)
    for code, rs in neg.items():
        out.append(_D("negative_value", 1, "condition", f"ENR|negative|{code}", f"Negative vote counts in {code}: {pl(len(rs), 'row')}", "; ".join(short(r["candidate"], 30) for r in rs[:EXAMPLES]), count=len(rs),
                      rows=[{"key": f"{code} | {r['contest']} | {r['candidate']}", "column": "total", "prev": None, "curr": num(r["total"]), "delta": None} for r in rs]))
    for code, rs in over.items():
        by_c = defaultdict(list)
        for r in rs:
            by_c[r["contest"]].append(r)
        for contest, lst in by_c.items():
            worst = max(lst, key=lambda r: num(r["total"]) - ballots[code])
            tier = 1 if num(worst["total"]) > 1.05 * ballots[code] else 2
            out.append(_D("exceeds_ballots", tier, "condition", f"ENR|exceeds|{code}|{contest}", f"More votes than ballots in {code}: {short(contest, 50)}",
                          f"{short(worst['candidate'], 35)} has {f(num(worst['total']))} votes but the county reports {f(ballots[code])} ballots cast.", prev=ballots[code], curr=num(worst["total"]), count=len(lst),
                          rows=[{"key": f"{code} | {contest} | {r['candidate']}", "column": "total", "prev": ballots[code], "curr": num(r["total"]), "delta": num(r["total"]) - ballots[code]} for r in lst]))
    n = max(len(rows), 1)
    for name, groups, kind, head in (("parts", parts, "parts_mismatch", "Total is not the sum of its parts"), ("pct", pct, "pct_mismatch", "Percent does not match the votes")):
        bad = sum(len(v) for v in groups.values())
        if not bad:
            continue
        if n >= 30 and bad / n >= 0.5:                      # everywhere = a definition we misread, not 46 broken counties
            out.append(_D(kind, 3, "condition", f"ENR|{name}|all", f"{head} in {bad} of {n} county rows", "that is most of the table: the site probably defines the column differently.", count=bad))
        else:
            for code, rs in groups.items():
                out.append(_D(kind, 3, "condition", f"ENR|{name}|{code}", f"{head} in {code}: {pl(len(rs), 'row')}", "; ".join(f"{short(r['candidate'], 28)} ({short(r['contest'], 30)})" for r in rs[:EXAMPLES]),
                              count=len(rs), rows=[{"key": f"{code} | {r['contest']} | {r['candidate']}", "column": name, "prev": None, "curr": num(r.get("total")), "delta": None} for r in rs]))
    return out


# ---- slow precincts ----------------------------------------------------------------------------------------------------


def data_slow(snap, prev, first):
    if first or not prev:
        return []
    return precinct_events(snap, prev, "SLOW", "raw")


# ---- turnout runs ------------------------------------------------------------------------------------------------------


def merge_by_county(findings):
    """One county's small corrections show up in several turnout tables at once (by_party, by_precinct, by_date, ...): the same ballots, seen
    from different angles. Report them once per county and kind, not once per table. Row-level detail keeps every table."""
    keep, groups = [], defaultdict(list)
    for fd in findings:
        parts = fd["scope"].split("|")
        if fd["kind"] in ("ballots_down", "parts_down", "value_blanked") and fd["mode"] == "event" and len(parts) == 3 and parts[0] == "TQV":
            groups[(fd["kind"], parts[2])].append((parts[1], fd))
        else:
            keep.append(fd)
    for (kind, county), members in groups.items():
        if len(members) == 1:
            keep.append(members[0][1])
            continue
        tables = [t for t, _ in members]
        worst = max((fd for _, fd in members), key=lambda fd: -(fd.get("delta") or 0))
        lost = max(-(fd.get("delta") or 0) for _, fd in members)
        what = {"ballots_down": f"Ballots dropped in {county}: −{f(lost)}", "parts_down": f"A part fell while its total held in {county}: −{f(lost)}",
                "value_blanked": f"Numbers went blank in {county}"}[kind]
        keep.append(_D(kind, min(fd["tier"] for _, fd in members), "event", f"TQV|county|{county}|{kind}", f"{what} (the same correction, in {len(tables)} tables: {', '.join(tables)})",
                       "; ".join(fd["detail"] for _, fd in members[:2]), prev=worst.get("prev"), curr=worst.get("curr"), delta=worst.get("delta"),
                       count=sum(fd["count"] for _, fd in members),
                       rows=[{**r, "key": f"{t} | {r['key']}"} for t, fd in members for r in fd["rows"]]))
    return keep


def data_turnout(snap, prev, first):
    out = []
    d = os.path.join(snap.path, "data")
    for name, cols in (("by_type.csv", ("ballots",)), ("by_party.csv", ("total", "mail", "earlyvoting", "electionday", "provisional")),
                       ("by_precinct.csv", ("total", "mail", "earlyvoting", "electionday", "provisional")), ("by_date.csv", ("ballots",)),
                       ("location_day.csv", ("ballots",)), ("location_party.csv", ("ballots",))):
        rows = read_csv(os.path.join(d, name))
        for r in rows or []:
            if any((num(r.get(c)) or 0) < 0 for c in cols):
                out.append(_D("negative_value", 1, "condition", f"TQV|negative|{name}", f"Negative ballot counts in {name}", f"e.g. {r}", count=1))
                break
    if first or not prev:
        return out
    p = os.path.join(prev.path, "data")
    specs = [("by_type.csv", ("county", "ballot_type"), ("ballots",), "ballots"),
             ("by_party.csv", ("county", "party_code"), ("total", "mail", "earlyvoting", "electionday", "provisional"), "total"),
             ("by_precinct.csv", ("county", "precinct_key"), ("total", "mail", "earlyvoting", "electionday", "provisional"), "total"),
             ("by_date.csv", ("county", "date", "ballot_type"), ("ballots",), "ballots"),
             ("location_day.csv", ("county", "location_id", "date"), ("ballots",), "ballots"),
             ("location_party.csv", ("county", "location_id", "party_code"), ("ballots",), "ballots")]
    found = []
    for name, keys, cols, main in specs:
        new, old = read_csv(os.path.join(d, name)), read_csv(os.path.join(p, name))
        if new is None or old is None:
            continue
        try:                                               # one table that cannot be compared must not silence the others
            found += table_events(old, new, keycols=keys, valcols=cols, main=main, group_by=("county",), title=lambda g, r, n=name: f"{r.get('county', g[0])} ({n[:-4]})",
                                  who=lambda r, ks=keys: " ".join((r.get(k) or "") for k in ks[1:]), src=f"TQV|{name[:-4]}", tier_fn=ballot_tier, unit="ballots",
                                  report_new=False)        # rows appear all through Election Day as people vote; that is growth, not news
        except Exception as e:
            found.append(_D("validator_error", 2, "condition", f"TQV|{name}", f"The data validator could not compare {name}", f"{type(e).__name__}: {str(e)[:160]}"))
    out += merge_by_county(found)
    new, old = read_csv(os.path.join(d, "counties.csv")), read_csv(os.path.join(p, "counties.csv"))
    if new is not None and old is not None:
        out += field_events(old, new, "code", {"eligible_voters": ("moved", _moved_pct(0.005), "count_changed", "registered voters"),
                                                "precincts": ("down", lambda a, b: 2, "count_changed", "precincts"),
                                                "locations_ev": ("down", lambda a, b: 3, "count_changed", "early-vote sites"),
                                                "locations_ed": ("down", lambda a, b: 3, "count_changed", "Election Day sites")}, src="TQV|counties", label=lambda k: k)
    om, nm = _manifest(prev), _manifest(snap)
    for k in ("ballots", "mail", "early"):
        a, b = (om.get("totals") or {}).get(k), (nm.get("totals") or {}).get(k)
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and b < a:
            out.append(_D("ballots_down", ballot_tier(a, b), "event", f"TQV|statewide|{k}", f"Statewide {k} ballots fell: {f(a)} → {f(b)} ({b - a:+,})", prev=a, curr=b, delta=b - a, count=1,
                          rows=[{"key": "statewide", "column": k, "prev": a, "curr": b, "delta": b - a}]))
    return out


def _manifest(snap):
    return j(os.path.join(snap.path, "manifest.json")) or {}


# ---- projections -------------------------------------------------------------------------------------------------------


def data_projections(snap, prev, first):
    out = []
    d = snap.path
    pred, calls = read_csv(os.path.join(d, "predictions.csv")) or [], read_csv(os.path.join(d, "calls.csv")) or []
    # ---- invariants
    bad = [r for r in pred if (p := num(r.get("win_probability"))) is not None and not 0 <= p <= 1]
    if bad:
        out.append(_D("prob_out_of_range", 1, "condition", "PROJ|range", f"{pl(len(bad), 'probability value')} outside 0-1", "; ".join(f"{r['source']} {r['race_key']} {r.get('candidate') or r.get('party')}: {r['win_probability']}" for r in bad[:EXAMPLES]),
                      count=len(bad), rows=[{"key": f"{r['source']} | {r['race_key']} | {r.get('candidate') or r.get('party')}", "column": "win_probability", "prev": None, "curr": num(r["win_probability"]), "delta": None} for r in bad]))
    sums = defaultdict(float)
    for r in pred:
        if r["source"] == "ddhq" and num(r.get("win_probability")) is not None:
            sums[r["race_key"]] += num(r["win_probability"])
    for race, s in sums.items():
        if abs(s - 1) > 0.05:
            out.append(_D("prob_sum_off", 2, "condition", f"PROJ|sum|ddhq|{race}", f"DDHQ probabilities for {race} add to {s:.2f}, not 1", "a candidate may be missing from the forecast.", curr=round(s, 3), count=1))
    winners = defaultdict(set)
    for r in calls:
        if str(r.get("winner")).lower() == "true":
            winners[(r["source"], r["race_key"])].add(r.get("candidate"))
    for (src, race), who in winners.items():
        if len(who) > 1:
            out.append(_D("two_winners", 1, "condition", f"PROJ|winners|{src}|{race}", f"{src.upper()} has called {len(who)} winners in {race}", ", ".join(sorted(who)), count=len(who)))
    if first or not prev:
        return out
    # ---- changes since the last pull
    opred, ocalls = read_csv(os.path.join(prev.path, "predictions.csv")) or [], read_csv(os.path.join(prev.path, "calls.csv")) or []

    def pkey(r):
        return (r["source"], r["race_key"], r.get("candidate") or r.get("party") or "")

    P = {pkey(r): num(r.get("win_probability")) for r in opred}
    jumps = defaultdict(list)
    for r in pred:
        k = pkey(r)
        a, b = P.get(k), num(r.get("win_probability"))
        if a is not None and b is not None and abs(b - a) >= 0.20:
            jumps[(k[0], k[1])].append((k[2], a, b))
    for (src, race), items in jumps.items():
        big = max(abs(b - a) for _, a, b in items)
        out.append(_D("prob_jump", 2 if big >= 0.40 else 3, "event", f"PROJ|jump|{src}|{race}", f"{src} moved {race} by {big * 100:.0f} points in one pull",
                      "; ".join(f"{short(n, 28)} {a * 100:.0f}% → {b * 100:.0f}%" for n, a, b in items[:EXAMPLES]), count=len(items), prev=items[0][1], curr=items[0][2],
                      rows=[{"key": f"{src} | {race} | {n}", "column": "win_probability", "prev": a, "curr": b, "delta": round(b - a, 4)} for n, a, b in items]))

    def ckey(r):
        return (r["source"], r["race_key"], r.get("candidate", ""), r.get("party", ""))

    PC = {ckey(r): r for r in ocalls}
    retracted, made = [], []
    for r in calls:
        o = PC.get(ckey(r))
        now_w = str(r.get("winner")).lower() == "true"
        was_w = o is not None and str(o.get("winner")).lower() == "true"
        if was_w and not now_w:
            retracted.append(r)
        elif now_w and not was_w:
            made.append(r)
    for r in retracted:
        out.append(_D("call_retracted", 1, "event", f"PROJ|retracted|{r['source']}|{r['race_key']}", f"{r['source'].upper()} took back its call in {r['race_key']}: {r.get('candidate')} is no longer the winner",
                      "a race call changed from won to not won.", count=1, rows=[{"key": f"{r['source']} | {r['race_key']} | {r.get('candidate')}", "column": "winner", "prev": True, "curr": False, "delta": None}]))
    for r in made:
        out.append(_D("call_made", 3, "event", f"PROJ|call|{r['source']}|{r['race_key']}", f"{r['source'].upper()} called {r['race_key']} for {r.get('candidate')} ({r.get('party')})",
                      f"precincts in: {r.get('precincts_in')}/{r.get('precincts_total')}", count=1, rows=[{"key": f"{r['source']} | {r['race_key']} | {r.get('candidate')}", "column": "winner", "prev": False, "curr": True, "delta": None}]))
    if calls and ocalls:
        out += table_events(ocalls, calls, keycols=("source", "race_key", "candidate", "party"), valcols=("votes", "precincts_in"), main="votes", group_by=("source", "race_key"),
                            title=lambda g, r: f"{g[0].upper()} {g[1]}", who=lambda r: r.get("candidate", ""), src="CALLS")
    return out


DATA = {"results": data_results, "slow": data_slow, "turnout": data_turnout, "projections": data_projections}


def data_checks(kind, snap, prev, first):
    return DATA[kind](snap, prev, first)
