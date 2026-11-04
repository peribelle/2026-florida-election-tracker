#!/usr/bin/env python3
"""validate.py --selftest: prove the validators fire.

Copies the latest real pulls into a throwaway tree, then breaks them in known ways and checks that the right alert fires at
the right tier, that a clean pull stays silent, and that the Python schedule matches election_day.sh minute for minute.
It runs the real validate.py in a subprocess, so it tests exactly what the pipeline runs. It never touches validation/ in
the real tree, never sends a notification, and cleans up after itself.
"""
import csv, glob, gzip, json, os, shutil, subprocess, sys, tempfile, time
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
DIRS = {"turnout": "runs", "results": "results", "slow": os.path.join("results", "slow"), "projections": "projections"}
RESULTS = []


def check(label, ok, extra=""):
    RESULTS.append(ok)
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"   [{extra}]" if extra and not ok else ""))


# ---- editing helpers ---------------------------------------------------------------------------------------------


def ecsv(path, fn, gz=False):
    op = (lambda p, m: gzip.open(p, m + "t", newline="")) if gz else (lambda p, m: open(p, m, newline=""))
    with op(path, "r") as fh:
        rd = csv.DictReader(fh)
        cols, rows = rd.fieldnames, list(rd)
    fn(rows)                                               # mutators edit the rows in place; whatever they return is ignored
    with op(path, "w") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)


def ejson(path, fn):
    with open(path) as fh:
        d = json.load(fh)
    fn(d)
    with open(path, "w") as fh:
        json.dump(d, fh)


def seed_votes(d):
    """Give one county, one statewide contest and one precinct file real, consistent numbers (the real pulls are all zeros)."""
    def enr(rows):
        mine = [r for r in rows if r["county_code"] == "ALA"]
        contest = mine[0]["contest"]
        cand = [r for r in mine if r["contest"] == contest]
        vals = [5000, 3000] + [0] * (len(cand) - 2)
        for r, v in zip(cand, vals):
            r.update(election_day=v, early=0, mail=0, provisional=0, total=v, pct=round(100 * v / sum(vals), 2))
    ecsv(f"{d}/county_contests.csv", enr)
    ecsv(f"{d}/county_enr_status.csv", lambda rows: [r.update(ballots_cast=20000, precincts_reporting=10) for r in rows if r["county_code"] == "ALA"])

    def few(rows):
        cid = rows[0]["contest_id"]
        cands = [(r["candidate"], r["party"]) for r in rows if r["contest_id"] == cid and r["county"] == "Alachua"]
        votes = {cands[0]: 1000, cands[1]: 800}
        for r in rows:
            if r["contest_id"] == cid:
                r["votes"] = votes.get((r["candidate"], r["party"]), 0) if r["county"] in ("Alachua", "TOTAL") else 0
    ecsv(f"{d}/contest_votes.csv", few)
    ecsv(f"{d}/county_status.csv", lambda rows: [r.update(voter_turnout=20000) for r in rows if r["county"] == "Alachua"])

    def prec(rows):
        for r, v in zip(rows[:2], (400, 300)):
            r.update({"Total Votes": v, "Election Day Votes": v, "Mail Votes": 0, "Early Votes": 0, "Provisional Votes": 0})
    ecsv(f"{d}/raw/precinct_BRA.csv.gz", prec, gz=True)


# ---- a throwaway tree --------------------------------------------------------------------------------------------


class Tree:
    def __init__(self):
        self.tmp = tempfile.mkdtemp(prefix="validate-selftest-")
        self.seen = 0
        self.clock = datetime(2026, 11, 3, 19, 0, 0)
        self.latest = {}
        for kind, d in DIRS.items():
            src_base, dst_base = os.path.join(HERE, d), os.path.join(self.tmp, d)
            with open(os.path.join(src_base, "INDEX.csv"), newline="") as fh:
                rd = csv.DictReader(fh)
                cols, rows = rd.fieldnames, list(rd)
            ok = [r for r in rows if os.path.isdir(os.path.join(src_base, r["run_id"])) and len(r["run_id"]) == 15]
            last = [r for r in ok if r["run_id"] < "20261103-000000"][-1]      # the last pre-election pull: live counting must not leak into the fixture
            # Copy the newest real pull but give it a fixed id from before the election. The real history now reaches into the
            # schedule (today's runs), and a test must not depend on how old the real data is.
            base_id = "20261102-120000"
            os.makedirs(dst_base, exist_ok=True)
            shutil.copytree(os.path.join(src_base, last["run_id"]), os.path.join(dst_base, base_id),
                            ignore=shutil.ignore_patterns("raw") if kind == "projections" else None)
            self._index(kind, cols, [{**{c: "" for c in cols}, "run_id": base_id, "created_local": "2026-11-02T12:00:00"}])
            self.latest[kind] = base_id

    def _index(self, kind, cols, rows):
        path = os.path.join(self.tmp, DIRS[kind], "INDEX.csv")
        new = not os.path.exists(path)
        with open(path, "a", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=cols)
            if new:
                w.writeheader()
            w.writerows(rows)

    def pull(self, kind, mutate=None, at=None):
        base = os.path.join(self.tmp, DIRS[kind])
        t = at or self.clock
        if not at:
            self.clock += timedelta(minutes=10)
        new = t.strftime("%Y%m%d-%H%M%S")
        shutil.copytree(os.path.join(base, self.latest[kind]), os.path.join(base, new))
        if kind == "turnout":                              # a healthy Broward, collected as this pull ran, unless the scenario says otherwise
            os.makedirs(os.path.join(base, new, "data", "broward"), exist_ok=True)
            if os.path.exists(os.path.join(base, new, "data", "broward", "blend.json")):       # the real base run was blended: a healthy Broward blends nothing
                os.remove(os.path.join(base, new, "data", "broward", "blend.json"))
            with open(os.path.join(base, new, "data", "broward", "status.json"), "w") as fh:
                json.dump({"ok": True, "attempted_at": t.isoformat(timespec="seconds"), "data_collected_at": t.isoformat(timespec="seconds"), "error": None}, fh)
        if kind == "turnout":                              # the feeds were touched as this pull ran, unless the scenario says otherwise
            mp = os.path.join(base, new, "manifest.json")
            with open(mp) as fh:
                man = json.load(fh)
            man["feed_time"] = (t + timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
            with open(mp, "w") as fh:
                json.dump(man, fh)
        if mutate:
            mutate(os.path.join(base, new))
        with open(os.path.join(base, "INDEX.csv"), newline="") as fh:
            cols = csv.DictReader(fh).fieldnames
        self._index(kind, cols, [{"run_id": new, "created_local": t.isoformat()}])
        self.latest[kind] = new
        return new

    def env(self, **extra):
        # NO_PUBLISH and NO_VALIDATE: nothing a test does may reach the real repo's publisher
        return dict(os.environ, VALIDATE_ROOT=self.tmp, VALIDATE_NOTIFY="0", NO_PUBLISH="1", ELECTION_DATE="2026-11-03", **extra)

    def run(self, *args, **extra):
        r = subprocess.run([sys.executable, os.path.join(HERE, "validate.py"), *args], capture_output=True, text=True, env=self.env(**extra), timeout=300)
        if r.returncode != 0:
            print("    validate.py failed:", (r.stderr or r.stdout)[-400:])
        path = os.path.join(self.tmp, "validation", "alerts.csv")
        if not os.path.exists(path):
            return []
        with open(path, newline="") as fh:
            rows = list(csv.DictReader(fh))
        new, self.seen = rows[self.seen:], len(rows)
        return new

    def current(self):
        with open(os.path.join(self.tmp, "validation", "current.json")) as fh:
            return json.load(fh)

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def has(rows, kind, tier=None, event="raised", contains="", validator=None):
    return any(r["kind"] == kind and (tier is None or int(r["tier"]) == tier) and r["event"] == event and contains in (r["scope"] + " " + r["headline"])
               and (validator is None or r["validator"] == validator) for r in rows)


def summarize(rows):
    return "; ".join(f"T{r['tier']} {r['event']} {r['kind']} {r['scope'][:40]}" for r in rows)[:300] or "no alerts"


def fresh():
    """A tree that has finished its first (bootstrap) run and holds one clean results pull with real numbers in it."""
    T = Tree()
    T.run()
    T.pull("results", seed_votes)
    T.run()
    return T


# ---- the scenarios -----------------------------------------------------------------------------------------------


def main():
    t0 = time.time()
    trees = []

    def tree():
        T = fresh()
        trees.append(T)
        return T

    try:
        print("DATA validator: numbers that must not shrink")
        T = tree()
        T.pull("results")
        T.pull("turnout"), T.pull("projections"), T.pull("slow")
        rows = T.run()
        check("an unchanged pull of every kind is silent", not rows, summarize(rows))

        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(election_day=4200, total=4200, pct=58.33) for r in rs if r["county_code"] == "ALA" and r["total"] == "5000"]))
        rows = T.run()
        check("a county's candidate loses 800 votes -> tier 1 votes_down", has(rows, "votes_down", 1, contains="ENR|ALA"), summarize(rows))

        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(election_day=4996, total=4996) for r in rs if r["county_code"] == "ALA" and r["total"] == "5000"]))
        rows = T.run()
        check("the same candidate loses 4 votes -> still flagged, tier 3", has(rows, "votes_down", 3, contains="ENR|ALA"), summarize(rows))

        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(early=0, mail=0, election_day=5000, total=5000) for r in rs if r["county_code"] == "ALA" and r["total"] == "5000"]))
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(election_day=3000, early=2000) for r in rs if r["county_code"] == "ALA" and r["total"] == "5000"]))
        rows = T.run()
        check("a part falls while its total holds (ballots reclassified) -> tier 3 parts_down", has(rows, "parts_down", 3) and not has(rows, "votes_down"), summarize(rows))

        T = tree()
        def few_drop(d):
            def fn(rows):
                cid = rows[0]["contest_id"]
                first = next(r for r in rows if r["contest_id"] == cid and r["county"] == "Alachua" and r["votes"] == "1000")
                for r in rows:
                    if r["contest_id"] == cid and r["candidate"] == first["candidate"] and r["county"] in ("Alachua", "TOTAL"):
                        r["votes"] = 988
            ecsv(f"{d}/contest_votes.csv", fn)
        T.pull("results", few_drop)
        rows = T.run()
        check("a statewide total falls by 12 votes (of 1,000) -> tier 2 votes_down on the state feed", has(rows, "votes_down", 2, contains="FEW"), summarize(rows))

        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_enr_status.csv", lambda rs: [r.update(ballots_cast=19000) for r in rs if r["county_code"] == "ALA"]))
        rows = T.run()
        check("a county's ballots-cast falls by 1,000 -> tier 1", has(rows, "votes_down", 1, contains="ALA"), summarize(rows))

        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_enr_status.csv", lambda rs: [r.update(precincts_reporting=3) for r in rs if r["county_code"] == "ALA"]))
        rows = T.run()
        check("precincts reporting goes backwards (10 -> 3) -> tier 1", has(rows, "precincts_regressed", 1, contains="ALA"), summarize(rows))

        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/raw/precinct_BRA.csv.gz", lambda rs: [rs[0].update({"Total Votes": 150, "Election Day Votes": 150})], gz=True))
        rows = T.run()
        check("a precinct loses 250 votes -> grouped alert for that county", has(rows, "votes_down", 1, contains="PREC|BRA"), summarize(rows))

        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(total=-5) for r in rs[:1]]))
        rows = T.run()
        check("a negative vote count -> tier 1", has(rows, "negative_value", 1), summarize(rows))

        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(election_day=30000, total=30000, pct=100) for r in rs if r["county_code"] == "ALA" and r["total"] == "5000"]))
        rows = T.run()
        check("a candidate with more votes than the county has ballots -> flagged", has(rows, "exceeds_ballots", contains="ALA"), summarize(rows))

        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(total=100, election_day=100, early=0, mail=0, provisional=0) for r in rs]))
        T.run()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [rs.pop() for _ in range(int(len(rs) * 0.6))]))
        rows = T.run()
        check("60% of a table that held votes vanishes at once -> tier 1 shape_changed, not a thousand alerts", has(rows, "shape_changed", 1) and len([r for r in rows if r["event"] == "raised"]) < 10, summarize(rows))
        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(total=0, election_day=0, early=0, mail=0, provisional=0) for r in rs]))
        T.run()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [rs.pop() for _ in range(int(len(rs) * 0.6))]))
        rows = T.run()
        check("...but when the vanished rows carried no votes (a county dropped its placeholders) it is only a notice", has(rows, "shape_changed", 3) and not has(rows, "shape_changed", 1), summarize(rows))

        T = tree()
        T.pull("turnout", lambda d: ejson(f"{d}/manifest.json", lambda m: m["totals"].update(ballots=m["totals"]["ballots"] - 3000)))
        rows = T.run()
        check("statewide ballots fall by 3,000 -> tier 1", has(rows, "ballots_down", 1, contains="statewide"), summarize(rows))

        T = tree()
        T.pull("turnout", lambda d: ejson(f"{d}/manifest.json", lambda m: m["totals"].update(early=m["totals"]["early"] - 7)))
        rows = T.run()
        check("statewide early votes dip by 7 (as in the real history) -> tier 3 only", has(rows, "ballots_down", 3) and not has(rows, "ballots_down", 1), summarize(rows))

        T = tree()
        T.pull("turnout", lambda d: ecsv(f"{d}/data/location_party.csv", lambda rs: [r.update(location_id="X" + r["location_id"]) for r in rs if r["county"] == "BROWARD"]))
        rows = T.run()
        check("rows re-keyed with the numbers carried over -> tier 3, never tier 1", has(rows, "rows_rekeyed", 3) and not any(int(r["tier"]) == 1 for r in rows), summarize(rows))

        T = tree()
        T.pull("projections", lambda d: ecsv(f"{d}/calls.csv", lambda rs: [r.update(winner=True) for r in rs if r["race_key"] == "FL-SEN"][:1]))
        rows = T.run()
        check("a race call is made -> tier 3 notice", has(rows, "call_made", 3), summarize(rows))
        T.pull("projections", lambda d: ecsv(f"{d}/calls.csv", lambda rs: [r.update(winner=False) for r in rs if r["race_key"] == "FL-SEN"]))
        rows = T.run()
        check("the call is taken back -> tier 1 call_retracted", has(rows, "call_retracted", 1), summarize(rows))

        print("\nSOURCE validator: pulls that fail")
        T = tree()
        def drop_few(d):
            os.remove(f"{d}/contest_votes.csv")
        T.pull("results", drop_few)
        rows = T.run()
        check("the state site's vote table is missing -> tier 1 table_missing", has(rows, "table_missing", 1, contains="contest_votes", validator="source"), summarize(rows))

        T = tree()
        T.pull("results", lambda d: ejson(f"{d}/summary.json", lambda s: (s["county_enr"].update(counties_ok=45, failures={"ALA": "HTTP 503"}))))
        rows = T.run()
        check("one county results site fails -> tier 2 county_site_failed", has(rows, "county_site_failed", 2, contains="ALA", validator="source"), summarize(rows))

        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_enr_status.csv", lambda rs: [r.update(election_date="8/18/2026") for r in rs if r["county_code"] == "ALA"]))
        rows = T.run()
        check("a county page for the wrong election -> tier 1 wrong_election", has(rows, "wrong_election", 1, validator="source"), summarize(rows))

        T = tree()
        T.pull("results", lambda d: os.remove(f"{d}/raw/precinct_BRA.csv.gz"))
        rows = T.run()
        check("a county that had a precinct file loses it -> tier 2", has(rows, "precinct_file_lost", 2, contains="BRA"), summarize(rows))

        T = tree()
        T.pull("projections", lambda d: ejson(f"{d}/summary.json", lambda s: s["sources"]["ddhq"].update(ok=False, error="HTTP 503")))
        rows = T.run()
        check("DDHQ fails (the only race-call authority) -> tier 1", has(rows, "source_down", 1, contains="ddhq"), summarize(rows))
        T.pull("projections", lambda d: ejson(f"{d}/summary.json", lambda s: (s["sources"]["ddhq"].update(ok=True, error=None), s["sources"]["kalshi"].update(ok=False, error="timeout"))))
        rows = T.run()
        check("Kalshi fails (a market source) -> tier 2, and DDHQ's alert clears", has(rows, "source_down", 2, contains="kalshi") and has(rows, "source_down", event="cleared", contains="ddhq"), summarize(rows))

        T = tree()
        T.pull("slow", lambda d: ejson(f"{d}/summary.json", lambda s: s.update(counties_ok=0, rows=0)))
        rows = T.run()
        check("the slow precinct pull reads nothing -> tier 1", has(rows, "slow_all_failed", 1), summarize(rows))

        T = tree()
        T.pull("turnout", lambda d: ecsv(f"{d}/data/counties.csv", lambda rs: [rs.pop() for _ in range(12)]))
        rows = T.run()
        check("12 of 67 counties vanish from the turnout feed -> flagged", has(rows, "counties_short", validator="source"), summarize(rows))

        T = tree()
        old_feed = lambda d: ejson(f"{d}/manifest.json", lambda m: m.update(feed_time="2026-11-03T01:00:00+00:00"))        # last touched the evening before
        T.pull("turnout", old_feed, at=datetime(2026, 11, 3, 7, 0, 0))
        rows = T.run()
        check("07:00 on election morning: feeds untouched since last night are not stale yet", not has(rows, "feed_stale") and not has(rows, "counties_stale"), summarize(rows))
        T.pull("turnout", old_feed, at=datetime(2026, 11, 3, 10, 30, 0))
        rows = T.run()
        check("10:30 and still untouched since last night -> feed_stale, measured from when polls opened", has(rows, "feed_stale", validator="source"), summarize(rows))

        def broward(collected, ok=False, err="HTTPError: 404"):
            return lambda d: json.dump({"ok": ok, "attempted_at": "2026-11-03T10:00:00", "data_collected_at": collected, "error": err}, open(f"{d}/data/broward/status.json", "w"))

        T = tree()
        T.pull("turnout", broward("2026-11-03T10:00:30", ok=True, err=None), at=datetime(2026, 11, 3, 10, 0, 0))
        rows = T.run()
        check("Broward collected on time -> no broward_stale", not has(rows, "broward_stale"), summarize(rows))
        T.pull("turnout", broward("2026-11-03T10:00:30"), at=datetime(2026, 11, 3, 11, 0, 0))
        rows = T.run()
        check("Broward's dashboard fails for one hour -> tier 2 broward_stale", has(rows, "broward_stale", 2, validator="source", contains="TQV|broward"), summarize(rows))
        T.pull("turnout", broward("2026-11-03T10:00:30"), at=datetime(2026, 11, 3, 13, 30, 0))
        rows = T.run()
        check("...and for three and a half hours with nothing blended in -> tier 1", has(rows, "broward_stale", 1) or has(rows, "broward_stale", 1, event="escalated"), summarize(rows))

        def blend(reported, active=True):
            return lambda d: json.dump({"active": active, "election_day": 99290, "dashboard_election_day": 0, "reported_at": reported, "fetched_at": reported,
                                        "date": "11/03/2026", "source": "selftest"}, open(f"{d}/data/broward/blend.json", "w"))

        def both(*fns):
            return lambda d: [fn(d) for fn in fns]

        T = tree()
        T.pull("turnout", both(broward("2026-11-03T10:00:30"), blend("2026-11-03T13:25:00")), at=datetime(2026, 11, 3, 13, 30, 0))
        rows = T.run()
        check("Broward down 3.5 hours but its Election Day total is blended in fresh from the state's page -> tier 2, and the alert says so",
              has(rows, "broward_stale", 2, validator="source", contains="blended in") and not has(rows, "broward_stale", 1), summarize(rows))
        T = tree()
        T.pull("turnout", both(broward("2026-11-03T10:00:30"), blend("2026-11-03T10:20:00")), at=datetime(2026, 11, 3, 13, 30, 0))
        rows = T.run()
        check("...but when the state's own figure is 3 hours old too, the blend no longer excuses it -> tier 1", has(rows, "broward_stale", 1, validator="source"), summarize(rows))
        T = tree()
        T.pull("turnout", broward("2026-11-03T10:00:30"), at=datetime(2026, 11, 3, 11, 0, 0))
        T.run()
        T.pull("turnout", both(broward("2026-11-03T10:00:30"), blend("2026-11-03T11:55:00")), at=datetime(2026, 11, 3, 12, 0, 0))
        rows = T.run()
        check("the blend takes over -> the 'nothing blended' alert clears and a 'blended in' one is raised at the tier that fits",
              has(rows, "broward_stale", 2, contains="blended in") and any(r["kind"] == "broward_stale" and r["event"] == "cleared" for r in rows), summarize(rows))
        T = tree()
        T.pull("turnout", both(broward("2026-11-03T10:00:30"), blend("not-a-time"), lambda d: ecsv(f"{d}/data/counties.csv", lambda rs: [rs.pop() for _ in range(12)])),
               at=datetime(2026, 11, 3, 11, 0, 0))
        rows = T.run()
        check("a crash inside the Broward check says so (tier 2, scoped to Broward)", has(rows, "validator_error", 2, validator="source", contains="TQV|broward|check"), summarize(rows))
        check("...and every other turnout check still ran in the same pull", has(rows, "counties_short", validator="source"), summarize(rows))

        T = tree()
        os.makedirs(f"{T.tmp}/logs", exist_ok=True)
        json.dump({"last_ok": "2026-11-03 18:00:00"}, open(f"{T.tmp}/logs/.publish_state.json", "w"))
        rows = T.run("--watch-once", VALIDATE_NOW="2026-11-03T19:05:00")
        check("a pull that is 5 minutes old is not a stale site (the publisher is allowed its spacing)", not has(rows, "site_stale"), summarize(rows))
        rows = T.run("--watch-once", VALIDATE_NOW="2026-11-03T19:20:00")
        check("the same pull 20 minutes on, still unpublished -> site_stale", has(rows, "site_stale", 2), summarize(rows))

        print("\nDATA validator, turnout: small corrections are not news")

        def lower(path, county, cols, by, n, floor=5):
            """Take `by` off `cols` in the first `n` rows of the county that hold at least `floor` in every one of them."""
            def fn(rows):
                done = 0
                for r in rows:
                    if done < n and r["county"] == county and all(int(r[c] or 0) >= floor for c in cols):
                        r.update({c: int(r[c]) - by for c in cols})
                        done += 1
            ecsv(path, fn)

        T = tree()
        T.pull("turnout", lambda d: [lower(f"{d}/data/by_party.csv", "PALM BEACH", ["total"], 2, 1), lower(f"{d}/data/by_precinct.csv", "PALM BEACH", ["total"], 2, 1),
                                     lower(f"{d}/data/by_date.csv", "PALM BEACH", ["ballots"], 2, 1)])
        rows = T.run()
        pb = [r for r in rows if "PALM BEACH" in r["scope"] and r["event"] == "raised"]
        check("one county's 2-ballot correction, seen in three turnout tables -> ONE notice, not three", len(pb) == 1 and int(pb[0]["tier"]) == 3 and "3 tables" in pb[0]["headline"], summarize(rows))

        T = tree()
        T.pull("turnout", lambda d: lower(f"{d}/data/by_precinct.csv", "PALM BEACH", ["total"], 1, 12))
        rows = T.run()
        check("twelve precincts lose 1 ballot each -> a notice, not a warning (a pile has to add up to something)", has(rows, "ballots_down", 3, contains="PALM BEACH") and not has(rows, "ballots_down", 2, contains="PALM BEACH"), summarize(rows))
        T = tree()
        T.pull("turnout", lambda d: lower(f"{d}/data/by_precinct.csv", "PALM BEACH", ["total"], 5, 12))
        rows = T.run()
        check("twelve precincts lose 5 ballots each (60) -> a warning", has(rows, "ballots_down", 2, contains="PALM BEACH"), summarize(rows))

        T = tree()
        T.pull("turnout", lambda d: ecsv(f"{d}/data/counties.csv", lambda rs: [r.update(eligible_voters=int(r["eligible_voters"]) + 1) for r in rs if r["county"] == "MIAMI-DADE"]))
        rows = T.run()
        check("a county's registered voters change by 1 (roll upkeep) -> silent", not has(rows, "count_changed"), summarize(rows))
        T = tree()
        T.pull("turnout", lambda d: ecsv(f"{d}/data/counties.csv", lambda rs: [r.update(eligible_voters=int(int(r["eligible_voters"]) * 0.98)) for r in rs if r["county"] == "MIAMI-DADE"]))
        rows = T.run()
        check("a county's registered voters fall 2% -> flagged tier 2", has(rows, "count_changed", 2), summarize(rows))

        def new_precinct(d):
            def fn(rs):
                r = dict(next(x for x in rs if x["county"] == "PALM BEACH"))
                r["precinct_key"] = "ZZ9999"
                rs.append(r)
            ecsv(f"{d}/data/by_precinct.csv", fn)
        T = tree()
        T.pull("turnout", new_precinct)
        rows = T.run()
        check("a precinct that is new in the turnout tables (people started voting there) is growth -> silent", not has(rows, "rows_new"), summarize(rows))
        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: rs.extend(dict(r, county_code="ZZZ") for r in rs[:5])))
        rows = T.run()
        check("...but a county coming online in the results is still announced (tier 3 rows_new)", has(rows, "rows_new", 3), summarize(rows))

        T = tree()
        def vote_for_two(d):
            def fn(rs):
                rows_ = [r for r in rs if r["county_code"] == "ALA" and r["contest"] == next(x["contest"] for x in rs if x["county_code"] == "ALA")]
                for r, (t, p_) in zip(rows_, ((600, 120.0), (400, 80.0))):
                    r.update(total=t, election_day=t, early=0, mail=0, provisional=0, pct=p_)
                for r in rows_[2:]:
                    r.update(total=0, election_day=0, early=0, mail=0, provisional=0, pct=0)
            ecsv(f"{d}/county_contests.csv", fn)
        T.pull("results", vote_for_two)
        rows = T.run()
        check("a vote-for-two contest whose percents are shares of ballots (summing to 200) is not a pct_mismatch", not has(rows, "pct_mismatch"), summarize(rows))

        print("\nSOURCE validator: a shorter precinct file")
        T = tree()
        T.pull("results", lambda d: ecsv(f"{d}/raw/precinct_BRA.csv.gz", lambda rs: [rs.pop(0) for _ in range(int(len(rs) * 0.6))], gz=True))
        rows = T.run()
        check("a precinct file that lost 60% of its rows AND its votes (truncated) -> tier 2 precinct_file_short", has(rows, "precinct_file_short", 2, contains="BRA"), summarize(rows))
        T = tree()
        def reload_file(d):
            def fn(rs):
                rs[0]["Total Votes"] = int(float(rs[0]["Total Votes"] or 0)) + 10
                del rs[int(len(rs) * 0.4):]
            ecsv(f"{d}/raw/precinct_BRA.csv.gz", fn, gz=True)
        T.pull("results", reload_file)
        rows = T.run()
        check("...but a file that got shorter while its votes held or rose (the county reloaded it) is not flagged", not has(rows, "precinct_file_short"), summarize(rows))

        print("\nDATA validator, results: a county that stops publishing the breakdown is not losing votes")
        T = tree()
        def split(d):
            ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(election_day=2000, early=2000, mail=1000, provisional=0, total=5000) for r in rs if r["county_code"] == "ALA" and r["total"] == "5000"])
        T.pull("results", split)
        T.run()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(election_day="", early="", mail="") for r in rs if r["county_code"] == "ALA" and r["total"] == "5000"]))
        rows = T.run()
        check("parts blank but the total held -> a notice about the breakdown, never a value_blanked warning", not has(rows, "value_blanked") and has(rows, "parts_down", 3) and not any(int(r["tier"]) <= 2 for r in rows if r["event"] == "raised" and r["kind"] in ("parts_down", "value_blanked")), summarize(rows))
        T = tree()
        T.pull("results", split)
        T.run()
        T.pull("results", lambda d: ecsv(f"{d}/county_contests.csv", lambda rs: [r.update(total=4000, election_day="", early="", mail="") for r in rs if r["county_code"] == "ALA" and r["total"] == "5000"]))
        rows = T.run()
        check("...but when the total fell too, it is still flagged as lost votes", has(rows, "votes_down", contains="ALA") or has(rows, "value_blanked") or any(r["kind"] == "votes_down" for r in rows), summarize(rows))

        print("\nacknowledging what has been looked at (--ack)")
        T = tree()
        T.pull("turnout", both(lambda d: ejson(f"{d}/manifest.json", lambda m: m["totals"].update(early=m["totals"]["early"] - 7)), broward("2026-11-03T10:00:30")),
               at=datetime(2026, 11, 3, 11, 0, 0))
        T.run()
        before = T.current()["counts"]
        check("before: a notice and a warning are on the board", before["3"] >= 1 and before["2"] >= 1, str(before))
        r = subprocess.run([sys.executable, os.path.join(HERE, "validate.py"), "--ack", "--note", "x"], capture_output=True, text=True, env=T.env())
        check("--ack with no selector refuses, so the whole board is never cleared by accident", r.returncode != 0 and T.current()["counts"] == before, (r.stderr or r.stdout)[-200:])
        rows = T.run("--ack", "--tier", "3", "--events", "--note", "dips of a few votes are county corrections")
        now = T.current()["counts"]
        check("acknowledging the notices takes them off the board and logs why", now["3"] == 0 and now["2"] == before["2"] and
              any(r["event"] == "acknowledged" and r["detail"].startswith("dips of a few") for r in rows), summarize(rows) + str(now))
        T.run("--ack", "--tier", "2", "--note", "Broward is down and its Election Day total is blended in")
        check("acknowledging a condition hides it", T.current()["counts"]["2"] == 0, str(T.current()["counts"]))
        T.pull("turnout", broward("2026-11-03T10:00:30"), at=datetime(2026, 11, 3, 12, 0, 0))
        rows = T.run()
        check("...and it stays hidden while it stays as it was", T.current()["counts"]["2"] == 0 and T.current()["counts"]["1"] == 0, summarize(rows) + str(T.current()["counts"]))
        T = tree()
        T.pull("turnout", broward("2026-11-03T10:00:30"), at=datetime(2026, 11, 3, 11, 0, 0))
        T.run()
        T.run("--ack", "--tier", "2", "--alert-kind", "broward_stale", "--note", "known")
        check("acknowledged by kind: the Broward warning is off the board", not any(i["kind"] == "broward_stale" for i in T.current()["items"]), str(T.current()["counts"]))
        T.pull("turnout", broward("2026-11-03T10:00:30"), at=datetime(2026, 11, 3, 13, 30, 0))
        rows = T.run()
        check("...but it is back on the board the moment it gets worse (acknowledging never buries a growing problem)", T.current()["counts"]["1"] == 1 and
              has(rows, "broward_stale", 1, event="escalated"), summarize(rows) + str(T.current()["counts"]))

        print("\nlifecycle: a condition is raised once, escalated if it persists, cleared when fixed")
        T = tree()
        bad = lambda d: ejson(f"{d}/summary.json", lambda s: s["county_enr"].update(counties_ok=45, failures={"ALA": "HTTP 503"}))
        good = lambda d: ejson(f"{d}/summary.json", lambda s: s["county_enr"].update(counties_ok=46, failures={}))
        T.pull("results", bad)
        r1 = T.run()
        T.pull("results", bad)
        r2 = T.run()
        T.pull("results", bad)
        r3 = T.run()
        T.pull("results", good)
        r4 = T.run()
        check("raised once at tier 2", has(r1, "county_site_failed", 2), summarize(r1))
        check("not repeated on the second pull", not r2, summarize(r2))
        check("escalated to tier 1 on the third", has(r3, "county_site_failed", 1, event="escalated"), summarize(r3))
        check("cleared when the county recovers", has(r4, "county_site_failed", event="cleared"), summarize(r4))
        items = T.current()["items"]
        check("current.json no longer lists the failure (a 'county stalled' notice for the frozen fake county is fine)",
              not any(i["kind"] == "county_site_failed" for i in items) and T.current()["status"] in ("clear", "notice"), T.current()["status"])

        T = tree()
        T.pull("results", at=datetime(2026, 11, 3, 19, 30, 0))
        rows = T.run()
        check("two scheduled results pulls never ran (19:10, 19:20) -> pull_gap", has(rows, "pull_gap", 2, validator="source"), summarize(rows))

        print("\nwatchdog: a pull that never arrives")
        T = tree()
        rows = T.run("--watch-once", VALIDATE_NOW="2026-11-03T19:35:00")
        check("19:10 and 19:20 results pulls missing at 19:35 -> tier 1 pull_missing", has(rows, "pull_missing", 1, contains="results"), summarize(rows))
        T.pull("results", at=datetime(2026, 11, 3, 19, 12, 0))
        T.pull("results", at=datetime(2026, 11, 3, 19, 22, 0))
        T.run()
        rows = T.run("--watch-once", VALIDATE_NOW="2026-11-03T19:35:00")
        check("the late pulls arrive -> the watchdog clears its alerts", has(rows, "pull_missing", event="cleared", contains="results"), summarize(rows))
        rows = T.run("--watch-once", VALIDATE_NOW="2026-11-03T06:00:00")
        check("before polls open the watchdog stays silent", not any(r["event"] != "cleared" for r in rows), summarize(rows))

        print("\nthe validators themselves")
        T = tree()
        def broken(d):
            with open(f"{d}/county_contests.csv", newline="") as fh:
                rows = list(csv.reader(fh))
            with open(f"{d}/county_contests.csv", "w", newline="") as fh:
                csv.writer(fh).writerows([r[1:] for r in rows])          # the county_code column is gone, header and all
            os.remove(f"{d}/ed_turnout.csv")
        T.pull("results", broken)
        rows = T.run()
        check("a validator that crashes says so (tier 2 validator_error)", has(rows, "validator_error", 2), summarize(rows))
        check("...and the other validator still ran in the same pull", has(rows, "table_missing", 1, contains="ed_turnout", validator="source"), summarize(rows))

        check_notify()
        check_schedule()
    finally:
        for T in trees:
            T.close()
    ok, total = sum(RESULTS), len(RESULTS)
    print(f"\n{ok}/{total} checks passed in {time.time() - t0:.0f}s")
    return 0 if ok == total else 1


def check_notify():
    """A tier-1 alert pops a desktop notification, a lone tier-3 does not, and the quiet file mutes it. notify-send is faked."""
    print("\nthe desktop notification")
    sys.path.insert(0, HERE)
    import validate
    calls, real_run, real_logs = [], validate.subprocess.run, validate.LOGS
    tmp = tempfile.mkdtemp(prefix="validate-notify-")
    saved = os.environ.pop("VALIDATE_NOTIFY", None)
    try:
        validate.subprocess.run = lambda cmd, *a, **k: calls.append(cmd)
        validate.LOGS = tmp
        critical = [{"event": "raised", "tier": 1, "headline": "votes dropped"}, {"event": "raised", "tier": 3, "headline": "a notice"}]
        validate.notify(critical)
        check("a new tier-1 alert pops one critical desktop notification", len(calls) == 1 and calls[0][:3] == ["notify-send", "-u", "critical"], str(calls))
        validate.notify([{"event": "raised", "tier": 3, "headline": "a notice"}, {"event": "cleared", "tier": 1, "headline": "fixed"}])
        check("a lone notice, or a cleared alert, pops nothing", len(calls) == 1, str(calls))
        open(os.path.join(tmp, ".validate_quiet"), "w").close()
        validate.notify(critical)
        check("touching logs/.validate_quiet mutes the popup", len(calls) == 1, str(calls))
    finally:
        validate.subprocess.run, validate.LOGS = real_run, real_logs
        if saved is not None:
            os.environ["VALIDATE_NOTIFY"] = saved
        shutil.rmtree(tmp, ignore_errors=True)


def check_schedule():
    """The Python copy of phase_for() must agree with election_day.sh for every minute of the election, or the watchdog lies."""
    print("\nthe schedule")
    sys.path.insert(0, HERE)
    import validate_checks as C
    script = f'''
ELECTION_DATE=2026-11-03; TURNOUT_START=7; POLLS_CLOSE=19; RESULTS_END=3; RESULTS_EVERY=10; TURNOUT_EVERY=60; NEXT_DAY=2026-11-04
eval "$(sed -n '/^phase_for() {{/,/^}}/p' '{HERE}/election_day.sh')"
for d in 2026-11-02 2026-11-03 2026-11-04 2026-11-05; do for h in $(seq 0 23); do for m in $(seq 0 59); do
  printf '%s %d %d ' "$d" "$h" "$m"; phase_for "$d" "$h" "$m"; echo
done; done; done'''
    out = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=120).stdout.splitlines()
    bad, fired = [], 0
    for line in out:
        parts = line.split(" ")
        d, h, m, ph = parts[0], int(parts[1]), int(parts[2]), (parts[3] if len(parts) > 3 else "")
        mine = C.phase_for(date.fromisoformat(d), h, m)
        fired += bool(ph)
        if mine != ph:
            bad.append((d, h, m, ph, mine))
    check(f"the Python schedule matches election_day.sh on all {len(out):,} minutes ({fired} firings)", len(out) > 5000 and not bad, str(bad[:3]))


if __name__ == "__main__":
    sys.exit(main())
