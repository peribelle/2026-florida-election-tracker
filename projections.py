#!/usr/bin/env python3
"""Snapshot Florida projections: forecast win probabilities and DDHQ race calls.

Sources (all public, no credentials):
  DDHQ Votes     official forecast model, per-candidate win probability,
                 and the race call (winner / called_at) once one is made
  Kalshi         market-priced win probability
  Polymarket     market-priced win probability

Isolation is the point. Each source is its own subprocess with its own hard
timeout; a source that fails writes nothing and is recorded as ok=false while
the others still produce their files. Nothing here can stop results.py.

Each run writes projections/<local timestamp>/ and appends to
projections/INDEX.csv. Snapshots are never overwritten.

Usage:
  projections.py                 # one snapshot, all sources
  projections.py --only ddhq     # a single source (dev)
  projections.py --dest DIR      # write into an existing directory
"""
import csv, fcntl, json, os, subprocess, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "projections")
LOCK = os.path.join(HERE, "logs", ".projections.lock")

# name, script, timeout seconds. DDHQ fetches ~30 race pages, the others a handful.
ADAPTERS = [("ddhq", "projections_ddhq.py", 900),
            ("kalshi", "projections_kalshi.py", 240),
            ("polymarket", "projections_polymarket.py", 240)]

PRED_COLS = ["fetched_utc", "source", "race_key", "race", "office", "district",
             "candidate", "party", "win_probability", "price_cents", "bid_cents",
             "ask_cents", "volume", "source_updated_at", "source_url"]
CALL_COLS = ["fetched_utc", "source", "race_key", "race", "office", "district",
             "candidate", "party", "winner", "called_at_utc", "votes", "percent",
             "precincts_in", "precincts_total", "source_url"]


def read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [{k: v for k, v in r.items() if k is not None} for r in csv.DictReader(f)]


def write_csv(path, rows, cols):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def run_adapters(selected, dest):
    """Launch each adapter as its own process. One dying never touches another."""
    procs, status = {}, {}
    for name, script, timeout in ADAPTERS:
        if selected and name not in selected:
            continue
        try:
            procs[name] = (subprocess.Popen(
                [sys.executable, os.path.join(HERE, script), dest],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True), timeout)
        except Exception as e:
            status[name] = {"ok": False, "error": f"spawn: {str(e)[:60]}"}

    for name, (proc, timeout) in procs.items():
        try:
            out, _ = proc.communicate(timeout=timeout)
            ok = proc.returncode == 0
            status[name] = {"ok": ok, "error": None if ok else f"exit {proc.returncode}"}
            for line in (out or "").splitlines():
                if line.strip():
                    print(line)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                out, _ = proc.communicate(timeout=15)
            except Exception:
                out = ""
            status[name] = {"ok": False, "error": f"timeout {timeout}s"}
            print(f"  ! {name} timed out after {timeout}s")
        sfile = os.path.join(dest, f"{name}_summary.json")
        if os.path.exists(sfile):
            try:
                status[name]["detail"] = json.load(open(sfile))
            except Exception:
                pass
    return status


def divergence(preds):
    """Same race+party seen by more than one source: how far apart are they?"""
    buckets = {}
    for p in preds:
        try:
            prob = float(p["win_probability"])
        except (TypeError, ValueError):
            continue
        key = (p["race_key"], p["party"] or p["candidate"])
        buckets.setdefault(key, {}).setdefault(p["source"], prob)
    prior = {"ddhq": 0, "kalshi": 1, "polymarket": 2}
    rows = []
    for (race_key, who), by_source in sorted(buckets.items()):
        if len(by_source) < 2:
            continue
        vals = list(by_source.values())
        rows.append({
            "race_key": race_key,
            "who": who,
            "sources": ",".join(sorted(by_source, key=lambda s: prior.get(s, 9))),
            "min_prob": round(min(vals), 4),
            "max_prob": round(max(vals), 4),
            "spread": round(max(vals) - min(vals), 4),
            **{f"p_{s}": round(v, 4) for s, v in by_source.items()},
        })
    rows.sort(key=lambda r: -r["spread"])
    return rows


def main():
    argv = sys.argv[1:]
    selected = None
    if "--only" in argv:
        i = argv.index("--only")
        if i + 1 < len(argv):
            selected = {argv[i + 1]}

    os.makedirs(LOCK.rsplit(os.sep, 1)[0], exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("  projections: another run holds the lock - skipping")
        return 0

    now_local = datetime.now()
    now_utc = datetime.now(timezone.utc)
    run_id = now_local.strftime("%Y%m%d-%H%M%S")

    if "--dest" in argv:
        dest = argv[argv.index("--dest") + 1]
        os.makedirs(dest, exist_ok=True)
    else:
        dest = os.path.join(OUT, run_id)
        os.makedirs(dest, exist_ok=False)
    ad_hoc = "--dest" in argv

    print(f"  projections snapshot {os.path.basename(dest)}")

    status = run_adapters(selected, dest)

    preds, calls = [], []
    for name, _, _ in ADAPTERS:
        preds.extend(read_csv(os.path.join(dest, f"predictions_{name}.csv")))
        calls.extend(read_csv(os.path.join(dest, f"calls_{name}.csv")))

    write_csv(os.path.join(dest, "predictions.csv"), preds, PRED_COLS)
    write_csv(os.path.join(dest, "calls.csv"), calls, CALL_COLS)

    div = divergence(preds)
    if div:
        cols = ["race_key", "who", "sources", "min_prob", "max_prob", "spread"]
        cols += sorted({c for r in div for c in r if c.startswith("p_")})
        write_csv(os.path.join(dest, "divergence.csv"), div, cols)

    covered = {}
    for p in preds:
        covered.setdefault(p["race_key"], set()).add(p["source"])
    for c in calls:
        covered.setdefault(c["race_key"], set()).add("calls")
    coverage = [{"race_key": k,
                 "race": next((p["race"] for p in preds if p["race_key"] == k), ""),
                 "sources": ",".join(sorted(v))}
                for k, v in sorted(covered.items())]
    if coverage:
        write_csv(os.path.join(dest, "coverage.csv"), coverage, ["race_key", "race", "sources"])

    called = [c for c in calls if str(c.get("winner")).lower() in ("true", "1")]
    summary = {
        "run_id": run_id,
        "created_local": now_local.isoformat(timespec="seconds"),
        "created_utc": now_utc.isoformat(timespec="seconds"),
        "sources": status,
        "sources_ok": sum(1 for s in status.values() if s.get("ok")),
        "sources_tried": len(status),
        "races_forecast": len({p["race_key"] for p in preds}),
        "prediction_rows": len(preds),
        "call_rows": len(calls),
        "called_candidates": len(called),
        "max_divergence": div[0]["spread"] if div else None,
        "files": sorted(os.listdir(dest)),
    }
    json.dump(summary, open(os.path.join(dest, "summary.json"), "w"), indent=1)

    # Ad-hoc runs (--dest, used for testing) never touch the production index.
    idx = os.path.join(OUT, "INDEX.csv")
    row = {"run_id": run_id,
           "created_local": summary["created_local"],
           "created_utc": summary["created_utc"],
           "ddhq_ok": int(bool(status.get("ddhq", {}).get("ok"))),
           "kalshi_ok": int(bool(status.get("kalshi", {}).get("ok"))),
           "polymarket_ok": int(bool(status.get("polymarket", {}).get("ok"))),
           "races_forecast": summary["races_forecast"],
           "prediction_rows": summary["prediction_rows"],
           "call_rows": summary["call_rows"],
           "called_candidates": summary["called_candidates"],
           "max_divergence": summary["max_divergence"] if summary["max_divergence"] is not None else "",
           "note": ""}
    if not ad_hoc:
        rows, fields = [], list(row)
        if os.path.exists(idx):
            with open(idx) as f:
                rd = csv.DictReader(f)
                fields = list(rd.fieldnames or []) + [k for k in row if k not in (rd.fieldnames or [])]
                rows = [{k: v for k, v in r.items() if k is not None} for r in rd]
        rows.append(row)
        with open(idx, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)

    bad = [n for n, s in status.items() if not s.get("ok")]
    print(f"  sources {summary['sources_ok']}/{summary['sources_tried']} ok"
          + (f"  FAILED: {bad}" if bad else ""))
    print(f"  {summary['prediction_rows']} probability rows across "
          f"{summary['races_forecast']} races, {summary['call_rows']} call rows "
          f"({summary['called_candidates']} called)")
    if div:
        print(f"  widest divergence {div[0]['spread']:.3f} on {div[0]['race_key']} "
              f"({div[0]['sources']})")
    print(f"  -> {'projections/' + run_id if not selected else os.path.basename(dest)}/")

    # Publish the new snapshot (ad-hoc --dest runs never touch the repo). publish.py runs detached behind its own lock,
    # so this can never delay or break the pull. NO_PUBLISH=1 skips it.
    if not ad_hoc:
        try:
            from publish import queue_publish
            queue_publish()
        except Exception as e:
            print(f"  ! publish not queued: {str(e)[:80]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
