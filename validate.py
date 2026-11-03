#!/usr/bin/env python3
"""The two validators: one fires when a SOURCE fails to pull, one fires when the DATA does something abnormal.

After every pull the collectors ask for a validation (after_pull.py). It runs detached, so a pull never waits on it.
For each new pull it runs both validators (the checks live in validate_checks.py and validate_data.py), turns what they
find into alerts, and writes:

  validation/alerts.csv        append-only log: every alert ever raised, escalated or cleared
  validation/runs.csv          append-only: one row per validator run
  validation/<run>/findings.csv  every row-level finding behind an alert, so nothing is ever summarised away
  validation/current.json      what is open right now (the viewer and --status read this; overwritten each run)
  validation/state.json        the validators' memory (high-water marks, open alerts); overwritten each run
  logs/validate.log            what each run did

Tiers: 1 CRITICAL (look now), 2 WARNING (look soon), 3 NOTICE (good to know).
A tier-1 or tier-2 alert also pops a desktop notification (VALIDATE_NOTIFY=0 turns that off).

Two kinds of alert. An EVENT is a change between two pulls ("votes dropped"); it is raised once. A CONDITION stays
true until fixed ("a county site is failing"); it is raised once, escalated one tier if it persists for 3 pulls, and
cleared when it goes away.

A snapshot only counts once it is in its INDEX.csv (the collectors append that last), so a half-written pull is never read.

Usage:
  validate.py              validate anything new, in the foreground
  validate.py --queue      ask for a run and return at once (what after_pull.py calls)
  validate.py --status     what is open right now, and the last run
  validate.py --replay     dry run over the saved history: what would have been flagged (writes nothing)
  validate.py --watch      the watchdog loop: validates anything new and raises alerts for pulls that never came
  validate.py --selftest   prove the validators catch what they should, on a copy of the real history

Environment: NO_VALIDATE=1 skips the ask; VALIDATE_NOTIFY=0 silences notifications; VALIDATE_ROOT points at another tree.
"""
import argparse, csv, fcntl, json, os, re, shutil, signal, subprocess, sys, tempfile, time, traceback
from collections import Counter
from datetime import datetime, timedelta, timezone

import validate_checks as C
import validate_data as D

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("VALIDATE_ROOT") or HERE
VAL = os.path.join(ROOT, "validation")
LOGS = os.path.join(ROOT, "logs")
LOG = os.path.join(LOGS, "validate.log")
LOCK = os.path.join(LOGS, ".validate.lock")
PENDING = os.path.join(LOGS, ".validate_pending")
ALERTS, RUNS = os.path.join(VAL, "alerts.csv"), os.path.join(VAL, "runs.csv")
STATE, CURRENT = os.path.join(VAL, "state.json"), os.path.join(VAL, "current.json")

DIRS = {"turnout": "runs", "results": "results", "slow": os.path.join("results", "slow"), "projections": "projections"}
RUN_ID = re.compile(r"^\d{8}-\d{6}$")
TIERS = {1: "CRITICAL", 2: "WARNING", 3: "NOTICE"}
ESCALATE_AFTER = 3            # a condition seen on this many pulls in a row moves up one tier
EVENT_WINDOW_H = 3            # events stay on the "open" list this long (the log keeps them forever)
RECENT_KEEP_H = 12
MAX_PER_RUN = 30              # pulls validated in one run, oldest first; the rest wait for the next run
ALERT_COLS = ["alert_id", "event", "raised_local", "raised_utc", "tier", "validator", "kind", "source", "scope", "headline", "detail",
              "prev", "curr", "delta", "count", "snapshot", "prev_snapshot", "fingerprint", "first_seen"]
GRACE = {"turnout": 600, "results": 360, "slow": 720, "projections": 360}      # seconds after a slot before a pull is "missing"


def log(msg):
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
    try:
        os.makedirs(LOGS, exist_ok=True)
        with open(LOG, "a") as fh:
            fh.write(line + "\n")
    except OSError:
        pass
    if sys.stdout.isatty():
        print(line)


def touch(path):
    with open(path, "a"):
        os.utime(path)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh, indent=1, sort_keys=True)
    os.replace(tmp, path)


def append_csv(path, cols, rows):
    if not rows:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    new = not os.path.exists(path)
    with open(path, "a", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        if new:
            w.writeheader()
        w.writerows(rows)


# ---- snapshots ---------------------------------------------------------------------------------------------------


def complete(kind):
    """Pulls that finished: listed in the kind's INDEX.csv and present on disk, oldest first."""
    base = os.path.join(ROOT, DIRS[kind])
    try:
        with open(os.path.join(base, "INDEX.csv"), newline="") as fh:
            ids = {r["run_id"] for r in csv.DictReader(fh)}
    except OSError:
        return []
    return [C.Snap(kind, i, os.path.join(base, i), datetime.strptime(i, "%Y%m%d-%H%M%S"))
            for i in sorted(ids) if RUN_ID.match(i) and os.path.isdir(os.path.join(base, i))]


def fresh_state():
    return {"version": 1, "validated": {}, "base": {}, "last": {}, "open": {}, "recent": [], "stale": {}, "totals": {"alerts": 0, "1": 0, "2": 0, "3": 0}}


def load_state():
    try:
        with open(STATE) as fh:
            st = json.load(fh)
        for k, v in fresh_state().items():
            st.setdefault(k, v)
        return st
    except (OSError, ValueError):
        return fresh_state()


# ---- running the checks ------------------------------------------------------------------------------------------


def guarded(validator, kind, snap, fn):
    """A validator that crashes must say so out loud; the other one still runs."""
    try:
        return fn()
    except Exception as e:
        tb = traceback.format_exc().strip().splitlines()
        return [C.finding(validator, "validator_error", 2, "condition", f"{validator}|{kind}", f"The {validator} validator crashed on {kind} {snap.id}",
                          f"{type(e).__name__}: {str(e)[:160]} ({tb[-2].strip()[:120] if len(tb) > 1 else ''})")]


def check_snapshot(state, kind, snap, prev_snap, first):
    """Run both validators on one pull. Updates the high-water marks and the memory of the last pull. Returns findings."""
    m = C.METRICS[kind](snap)
    base = state["base"].setdefault(kind, {})
    prev_m = state["last"].get(kind)
    findings = guarded("source", kind, snap, lambda: C.source_checks(kind, snap, m, base, base, prev_m, prev_snap, state))
    findings += guarded("data", kind, snap, lambda: D.data_checks(kind, snap, prev_snap, first))
    C.fold(base, m)
    state["last"][kind] = m
    state["validated"][kind] = snap.id
    return findings


def fold_only(state, kind, snap):
    m = C.METRICS[kind](snap)
    C.fold(state["base"].setdefault(kind, {}), m)
    state["last"][kind] = m


def validate_pending(state, only=None):
    """All findings for every pull that has not been validated yet. Returns [(snap, prev_snap, findings)]."""
    out = []
    for kind in C.METRICS:
        if only and kind != only:
            continue
        snaps = complete(kind)
        if not snaps:
            continue
        done = state["validated"].get(kind)
        if done is None:
            # first sight of this kind: learn the history, then judge only the latest pull (current problems, no "changes")
            for s in snaps[:-1]:
                fold_only(state, kind, s)
            prev_snap = snaps[-2] if len(snaps) > 1 else None
            out.append((snaps[-1], prev_snap, check_snapshot(state, kind, snaps[-1], prev_snap, first=True)))
            continue
        todo = [(i, s) for i, s in enumerate(snaps) if s.id > done][:MAX_PER_RUN]
        for i, s in todo:
            prev_snap = snaps[i - 1] if i > 0 else None
            out.append((s, prev_snap, check_snapshot(state, kind, s, prev_snap, first=False)))
    return out


# ---- the alert lifecycle ------------------------------------------------------------------------------------------


def _row(fd, event, ident, now, snap_id, prev_id, source, first_seen=None):
    return {"alert_id": ident, "event": event, "raised_local": f"{now:%Y-%m-%d %H:%M:%S}", "raised_utc": datetime.fromtimestamp(now.timestamp(), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tier": fd["tier"], "validator": fd["validator"], "kind": fd["kind"], "source": source, "scope": fd["scope"], "headline": fd["headline"], "detail": fd.get("detail", ""),
            "prev": fd.get("prev"), "curr": fd.get("curr"), "delta": fd.get("delta"), "count": fd.get("count", 1), "snapshot": snap_id, "prev_snapshot": prev_id or "",
            "fingerprint": fd["fingerprint"], "first_seen": first_seen or f"{now:%Y-%m-%d %H:%M:%S}"}


def apply_findings(state, findings, source, snap_id, prev_id, now, origin, seq, scope_source=None, escalate=True):
    """Findings -> alert rows. Events are raised once. Conditions are raised once, escalated if they persist, cleared when gone.
    Returns (alert rows, findings that produced a row). `source` names where it came from; conditions from one source are cleared by that source only."""
    rows, shown, seen = [], [], set()
    for fd in findings:
        fp = f"{fd['validator']}|{fd['kind']}|{fd['scope']}" + (f"|{snap_id}" if fd["mode"] == "event" else "")
        fd["fingerprint"] = fp
        if fd["mode"] == "event":
            seq[0] += 1
            row = _row(fd, "raised", f"A-{snap_id}-{seq[0]:03d}", now, snap_id, prev_id, source)
            rows.append(row)
            shown.append(fd)
            state["recent"].append(dict(row))
            continue
        seen.add(fp)
        o = state["open"].get(fp)
        if o is None:
            seq[0] += 1
            row = _row(fd, "raised", f"A-{snap_id}-{seq[0]:03d}", now, snap_id, prev_id, source)
            rows.append(row)
            shown.append(fd)
            state["open"][fp] = {"row": row, "n": 1, "origin": origin, "source": scope_source or source, "tier": fd["tier"], "last": row["raised_local"]}
        else:
            o["n"] += 1
            o["last"] = f"{now:%Y-%m-%d %H:%M:%S}"
            o["row"].update({"headline": fd["headline"], "detail": fd.get("detail", ""), "count": fd.get("count", 1), "curr": fd.get("curr"), "prev": fd.get("prev"), "delta": fd.get("delta")})
            if escalate and o["n"] == ESCALATE_AFTER and o["tier"] > 1:
                o["tier"] -= 1
                o["row"]["tier"] = o["tier"]
                fd2 = dict(fd, tier=o["tier"], headline=f"{fd['headline']} (still true after {o['n']} pulls)")
                seq[0] += 1
                rows.append(_row(fd2, "escalated", o["row"]["alert_id"], now, snap_id, prev_id, source, o["row"]["first_seen"]))
                shown.append(fd2)
    for fp, o in list(state["open"].items()):               # conditions this source can see and no longer finds
        if o["origin"] == origin and o["source"] == (scope_source or source) and fp not in seen:
            fd = {"validator": o["row"]["validator"], "kind": o["row"]["kind"], "tier": 3, "scope": o["row"]["scope"], "headline": f"Cleared: {o['row']['headline']}",
                  "detail": f"was tier {o['tier']}, open for {C.pl(o['n'], 'check')}", "fingerprint": fp}
            rows.append(_row(fd, "cleared", o["row"]["alert_id"], now, snap_id, prev_id, source, o["row"]["first_seen"]))
            del state["open"][fp]
    return rows, shown


def prune(state, now):
    cut = now - timedelta(hours=RECENT_KEEP_H)
    state["recent"] = [r for r in state["recent"] if datetime.strptime(r["raised_local"], "%Y-%m-%d %H:%M:%S") >= cut][-400:]


def build_current(state, now, last_run):
    horizon = now - timedelta(hours=EVENT_WINDOW_H)
    items = [dict(o["row"], tier=o["tier"], state="open", checks=o["n"], last_seen=o["last"]) for o in state["open"].values()]
    items += [dict(r, state="event") for r in state["recent"] if datetime.strptime(r["raised_local"], "%Y-%m-%d %H:%M:%S") >= horizon]
    items.sort(key=lambda r: r["raised_local"], reverse=True)       # newest first, then the stable sort puts the worst tier on top
    items.sort(key=lambda r: int(r["tier"]))
    counts = Counter(int(r["tier"]) for r in items)
    status = "critical" if counts[1] else "warning" if counts[2] else "notice" if counts[3] else "clear"
    return {"schema": 1, "generated_local": f"{now:%Y-%m-%dT%H:%M:%S}", "generated_utc": datetime.fromtimestamp(now.timestamp(), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "status": status, "counts": {str(t): counts[t] for t in (1, 2, 3)},
            "window_hours": EVENT_WINDOW_H, "items": items[:150], "totals": state["totals"], "validated": state["validated"], "last_run": last_run}


# ---- notifications -----------------------------------------------------------------------------------------------


def notify(rows):
    """A desktop notification for new tier-1 and tier-2 alerts, once per run. Never raises."""
    if os.environ.get("VALIDATE_NOTIFY", "1") == "0":
        return
    hot = [r for r in rows if r["event"] in ("raised", "escalated") and int(r["tier"]) <= 2]
    if not hot:
        return
    t1 = [r for r in hot if int(r["tier"]) == 1]
    title = f"Election tracker: {len(t1)} critical, {len(hot) - len(t1)} warning"
    body = "\n".join("• " + r["headline"][:140] for r in sorted(hot, key=lambda r: int(r["tier"]))[:4])
    try:
        subprocess.run(["notify-send", "-u", "critical" if t1 else "normal", "-a", "election-tracker", title, body], timeout=5, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        pass


# ---- one run -----------------------------------------------------------------------------------------------------


def write_findings(run_id, shown, snap_ids):
    rows = []
    for fd in shown:
        for r in fd.get("rows", []):
            rows.append({"fingerprint": fd["fingerprint"], "tier": fd["tier"], "validator": fd["validator"], "kind": fd["kind"], "scope": fd["scope"],
                         "snapshot": snap_ids.get(fd["fingerprint"], ""), **r})
    append_csv(os.path.join(VAL, run_id, "findings.csv"), ["fingerprint", "tier", "validator", "kind", "scope", "snapshot", "key", "column", "prev", "curr", "delta"], rows)
    return len(rows)


def run_once(only=None, dry=False):
    """Validate every pull that is new since the last run. Returns a dict describing the run."""
    t0 = time.time()
    now = datetime.now()
    state = fresh_state() if dry else load_state()
    batches = validate_pending(state, only)
    rows, shown, snap_ids, seq = [], [], {}, [0]
    for snap, prev_snap, findings in batches:
        src_rows, src_shown = apply_findings(state, findings, snap.kind, snap.id, prev_snap.id if prev_snap else "", now, "snapshot", seq)
        rows += src_rows
        shown += src_shown
        snap_ids.update({fd["fingerprint"]: snap.id for fd in src_shown})
    for r in rows:
        if r["event"] in ("raised", "escalated"):
            state["totals"]["alerts"] += 1
            state["totals"][str(r["tier"])] += 1
    run_id = f"{now:%Y%m%d-%H%M%S}"
    detail_rows = 0
    prune(state, now)
    summary = {"run_id": run_id, "ran_local": f"{now:%Y-%m-%d %H:%M:%S}", "pulls": [f"{s.kind}:{s.id}" for s, _, _ in batches],
               "raised": sum(1 for r in rows if r["event"] == "raised"), "escalated": sum(1 for r in rows if r["event"] == "escalated"),
               "cleared": sum(1 for r in rows if r["event"] == "cleared"), "tier1": sum(1 for r in rows if r["event"] != "cleared" and int(r["tier"]) == 1),
               "tier2": sum(1 for r in rows if r["event"] != "cleared" and int(r["tier"]) == 2), "tier3": sum(1 for r in rows if r["event"] != "cleared" and int(r["tier"]) == 3),
               "seconds": round(time.time() - t0, 1)}
    if not dry and batches:
        append_csv(ALERTS, ALERT_COLS, rows)
        detail_rows = write_findings(run_id, shown, snap_ids)
        summary["detail_rows"] = detail_rows
        append_csv(RUNS, ["run_id", "ran_local", "pulls", "raised", "escalated", "cleared", "tier1", "tier2", "tier3", "seconds", "detail_rows"],
                   [dict(summary, pulls=" ".join(summary["pulls"]), detail_rows=detail_rows)])
        write_json(CURRENT, build_current(state, now, summary))
        write_json(STATE, state)
        notify(rows)
    summary["rows"], summary["state"] = rows, state
    if not dry and batches:
        log(f"validated {C.pl(len(batches), 'pull')}: {summary['raised']} raised, {summary['escalated']} escalated, {summary['cleared']} cleared "
            f"(T1 {summary['tier1']}, T2 {summary['tier2']}, T3 {summary['tier3']}) in {summary['seconds']}s")
    return summary


# ---- the watchdog: what only a clock can see -----------------------------------------------------------------------


def watch_findings(now, state):
    """Pulls that never arrived, pulls that never finished, a site that stopped updating. Only inside the election window."""
    out = []
    if C.window(now) == "off":
        return out
    newest_any = None
    for kind, grace in GRACE.items():
        slots = C.expected_slots(kind)
        overdue = [s for s in slots if s + timedelta(seconds=grace) <= now][-3:]
        times = [s.t for s in complete(kind)]
        missed = []
        for s in overdue:
            nxt = next((x for x in slots if x > s), s + timedelta(seconds=C.CADENCE[kind]))
            if not any(s - timedelta(seconds=20) <= t < nxt for t in times):
                missed.append(s)
        for s in missed:
            out.append(C.finding("source", "pull_missing", 1 if len(missed) >= 2 else 2, "condition", f"watch|{kind}|{s:%H%M}",
                                 f"No {kind} pull arrived for the {s:%H:%M} slot", f"due {s:%H:%M}, now {now:%H:%M}. The scheduler may be stopped, or the collector crashed before saving.", count=1))
        newest = times[-1] if times else None
        if newest and (newest_any is None or newest > newest_any):
            newest_any = newest
        base = os.path.join(ROOT, DIRS[kind])
        ids = {s.id for s in complete(kind)}
        start = datetime.combine(C.ELECTION_DATE, datetime.min.time())
        try:
            names = os.listdir(base)
        except OSError:
            names = []
        for n in names:
            if RUN_ID.match(n) and n not in ids:
                t = datetime.strptime(n, "%Y%m%d-%H%M%S")
                if t >= start and now - t > timedelta(minutes=15):
                    out.append(C.finding("source", "pull_stuck", 2, "condition", f"watch|{kind}|{n}", f"A {kind} pull started at {t:%H:%M} and never finished",
                                         f"{base}/{n} is not in INDEX.csv {int((now - t).total_seconds() // 60)} minutes later: the collector crashed or hung.", count=1))
    ps = C.j(os.path.join(LOGS, ".publish_state.json")) or {}
    try:
        ok = datetime.strptime(ps["last_ok"], "%Y-%m-%d %H:%M:%S") if ps.get("last_ok") else None
    except ValueError:
        ok = None
    if ps and newest_any and ok and newest_any - ok > timedelta(minutes=20):
        out.append(C.finding("source", "site_stale", 2, "condition", "watch|site", f"The site is {int((newest_any - ok).total_seconds() // 60)} minutes behind the data",
                             f"last publish {ok:%H:%M}, newest pull {newest_any:%H:%M}. " + (f"Last error: {ps.get('last_error', '')[:140]}" if ps.get("last_error") else "No error recorded."), count=1))
    return out


def watch_once():
    now = datetime.fromisoformat(os.environ["VALIDATE_NOW"]) if os.environ.get("VALIDATE_NOW") else datetime.now()     # VALIDATE_NOW: for tests
    state = load_state()
    findings = watch_findings(now, state)
    seq = [0]
    ident = f"W{now:%Y%m%d-%H%M%S}"
    # outside the election window the watchdog finds nothing, so whatever the clock opened is cleared here
    rows, shown = apply_findings(state, findings, "watchdog", ident, "", now, "watch", seq, escalate=False)
    if not rows:
        return None
    for r in rows:
        if r["event"] in ("raised", "escalated"):
            state["totals"]["alerts"] += 1
            state["totals"][str(r["tier"])] += 1
    summary = {"run_id": f"{now:%Y%m%d-%H%M%S}", "ran_local": f"{now:%Y-%m-%d %H:%M:%S}", "pulls": ["watchdog"], "raised": sum(1 for r in rows if r["event"] == "raised"),
               "escalated": sum(1 for r in rows if r["event"] == "escalated"), "cleared": sum(1 for r in rows if r["event"] == "cleared"),
               "tier1": sum(1 for r in rows if r["event"] != "cleared" and int(r["tier"]) == 1), "tier2": sum(1 for r in rows if r["event"] != "cleared" and int(r["tier"]) == 2),
               "tier3": sum(1 for r in rows if r["event"] != "cleared" and int(r["tier"]) == 3), "seconds": 0}
    prune(state, now)
    append_csv(ALERTS, ALERT_COLS, rows)
    append_csv(RUNS, ["run_id", "ran_local", "pulls", "raised", "escalated", "cleared", "tier1", "tier2", "tier3", "seconds"], [dict(summary, pulls="watchdog")])
    write_json(CURRENT, build_current(state, now, summary))
    write_json(STATE, state)
    notify(rows)
    log("watchdog: " + "; ".join(f"{r['event']} T{r['tier']} {r['headline'][:90]}" for r in rows))
    ask_publish()
    return rows


# ---- running it: lock, queue, worker -------------------------------------------------------------------------------


def locked(fn, wait=False):
    """Run fn() holding the validator lock. Returns (ran, result). If someone else holds it: (False, None)."""
    os.makedirs(LOGS, exist_ok=True)
    fh = open(LOCK, "w")
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
    except BlockingIOError:
        fh.close()
        return False, None
    try:
        return True, fn()
    finally:
        fcntl.flock(fh, fcntl.LOCK_UN)
        fh.close()


def queue_validate():
    """Ask for a validation and return at once. Never raises, never blocks."""
    if os.environ.get("NO_VALIDATE", "") not in ("", "0"):
        return
    try:
        os.makedirs(LOGS, exist_ok=True)
        touch(PENDING)
        subprocess.Popen([sys.executable, os.path.abspath(__file__), "--worker"], cwd=HERE, stdin=subprocess.DEVNULL, stdout=open(LOG, "a"), stderr=subprocess.STDOUT,
                         start_new_session=True)
    except Exception as e:
        print(f"  ! validation not queued: {str(e)[:80]}")


def worker():
    try:
        os.nice(10)
    except OSError:
        pass
    while True:
        locked(drain, wait=True)           # the watchdog holds the lock only for a moment; wait for it rather than leave this pull for its next tick
        if not os.path.exists(PENDING):
            return


def drain():
    while os.path.exists(PENDING):
        try:
            os.remove(PENDING)
        except FileNotFoundError:
            pass
        try:
            run_once()
        except Exception as e:
            log(f"validator run failed: {type(e).__name__}: {str(e)[:160]}\n" + traceback.format_exc()[-600:])


def ask_publish():
    """Alerts the clock raised have no pull behind them, so nothing else will put them on the site. Never raises.

    Only for the real tree: publish.py always publishes the repo it lives in, so a validator pointed elsewhere (VALIDATE_ROOT,
    which is what the selftest does) must not ask it to."""
    if ROOT != HERE:
        return
    try:
        import publish
        publish.queue_publish()
    except Exception as e:
        log(f"publish not queued: {str(e)[:100]}")


def watch_over(now):
    """The watchdog retires itself 40 minutes after the last scheduled pull, so it is never left running for days."""
    return now > datetime.combine(C.ELECTION_DATE + timedelta(days=1), datetime.min.time()) + timedelta(hours=C.RESULTS_END, minutes=40)


def watch_loop(every=30):
    os.makedirs(LOGS, exist_ok=True)
    single = open(os.path.join(LOGS, ".validate_watch.lock"), "w")          # one watchdog at a time, or alerts would double
    try:
        fcntl.flock(single, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("a watchdog is already running")
        return
    log("watchdog started (pid %d)" % os.getpid())
    try:
        os.nice(10)
    except OSError:
        pass
    while True:
        if watch_over(datetime.now()):
            log("watchdog: the election window is over; exiting")
            return
        try:
            ran, res = locked(lambda: (run_once(), watch_once()))
            if ran and res[0]["pulls"]:                     # a pull whose after-pull ask never came: put its alerts on the site too
                ask_publish()
        except Exception as e:
            log(f"watchdog error: {type(e).__name__}: {str(e)[:160]}")
        time.sleep(every)


# ---- reading it back ---------------------------------------------------------------------------------------------


def status():
    cur = C.j(CURRENT)
    if not cur:
        print("validators: nothing recorded yet (they run after each pull; try `validate.py` to run now)")
        return
    print(f"validators: {cur['status'].upper()}   as of {cur['generated_local']}   open/recent: T1 {cur['counts']['1']}  T2 {cur['counts']['2']}  T3 {cur['counts']['3']}")
    print("validated up to:", ", ".join(f"{k} {v}" for k, v in sorted(cur["validated"].items())) or "nothing")
    t = cur["totals"]
    print(f"all night: {t['alerts']} alerts raised (T1 {t['1']}, T2 {t['2']}, T3 {t['3']})")
    for it in cur["items"][:25]:
        print(f"  T{it['tier']} {it['validator']:6} {it['kind']:20} {it['headline'][:130]}   [{it['state']}, {it['raised_local'][11:16]}]")
    if len(cur["items"]) > 25:
        print(f"  ... and {len(cur['items']) - 25} more in validation/current.json")


def replay(only=None, last=None):
    """What the validators would have said about the saved history. Writes nothing, notifies nobody."""
    for kind in C.METRICS:
        if only and kind != only:
            continue
        snaps = complete(kind)
        if last:
            snaps = snaps[-(last + 1):]
        state = fresh_state()
        print(f"\n== {kind}: {len(snaps)} pulls ==")
        for i, s in enumerate(snaps):
            fs = check_snapshot(state, kind, s, snaps[i - 1] if i else None, first=(i == 0))
            seq = [0]
            rows, _ = apply_findings(state, fs, kind, s.id, snaps[i - 1].id if i else "", datetime.now(), "snapshot", seq)
            print(f"  {s.id}: {C.pl(len(rows), 'alert')}")
            for r in sorted(rows, key=lambda r: int(r["tier"])):
                print(f"     T{r['tier']} {r['event']:9} {r['validator']:6} {r['kind']:18} {r['headline'][:140]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for flag, hlp in (("--queue", "ask for a run and return at once"), ("--worker", "the detached worker (internal)"), ("--status", "what is open now"),
                      ("--replay", "dry run over the saved history"), ("--watch", "the watchdog loop"), ("--watch-once", "one watchdog pass (for tests)"), ("--selftest", "prove the validators catch what they should")):
        ap.add_argument(flag, action="store_true", help=hlp)
    ap.add_argument("--kind", choices=list(C.METRICS), help="with --replay: only this kind")
    ap.add_argument("--last", type=int, help="with --replay: only the last N pulls")
    a = ap.parse_args()
    if a.status:
        status()
    elif a.queue:
        queue_validate()
    elif a.worker:
        worker()
    elif a.replay:
        replay(a.kind, a.last)
    elif a.watch:
        watch_loop()
    elif a.watch_once:
        locked(watch_once, wait=True)
    elif a.selftest:
        import validate_selftest
        return validate_selftest.main()
    else:
        ran, res = locked(lambda: run_once(), wait=True)
        s = res
        print(f"validated {C.pl(len(s['pulls']), 'pull')}: {s['raised']} raised, {s['escalated']} escalated, {s['cleared']} cleared "
              f"(T1 {s['tier1']}, T2 {s['tier2']}, T3 {s['tier3']}) in {s['seconds']}s")
        for r in sorted(s["rows"], key=lambda r: int(r["tier"])):
            print(f"  T{r['tier']} {r['event']:9} {r['validator']:6} {r['headline'][:140]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
