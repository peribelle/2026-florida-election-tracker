#!/usr/bin/env python3
"""Snapshot every run to runs/<run-id>/ and append to runs/INDEX.csv.

Nothing already on disk is ever modified: each run gets its own directory, raw
feeds are zipped, and every artefact is checksummed in a manifest.
"""
import csv, hashlib, json, os, shutil, zipfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")
INDEX = os.path.join(RUNS, "INDEX.csv")
REPORTS = os.path.join(HERE, "Reports")

KEEP = ["collect.py", "collect_broward.py", "parse_broward.py", "normalize.py",
        "build_workbook.py", "write_lists.py", "make_preview.py", "report_delta.py",
        "archive.py", "refresh.sh", "README.md"]


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def workbook_totals():
    import openpyxl
    p = os.path.join(REPORTS, "Florida_2026_General_Turnout.xlsx")
    wb = openpyxl.load_workbook(p, data_only=True)
    ws = wb["County Summary"]
    for r in ws.iter_rows(min_row=5, values_only=True):
        if r[0] == "FLORIDA":
            return {"ballots": r[2], "mail": r[4], "early": r[5],
                    "election_day": r[6], "provisional": r[7], "eligible": r[8],
                    "turnout_pct": round(100 * r[2] / r[8], 4)}
    raise SystemExit("no FLORIDA total row found")


def feed_time():
    """Newest LastUpdatedTime in the raw county feeds."""
    d = os.path.join(HERE, "raw", "tqv")
    best = ""
    for fn in os.listdir(d):
        if not fn.endswith(".json"):
            continue
        try:
            t = json.load(open(os.path.join(d, fn)))["Summary"].get("LastUpdatedTime", "")
        except Exception:
            continue
        best = max(best, t)
    return best


def broward_note():
    """If Broward's dashboard failed, say so on the run: its numbers are carried over from an earlier pull."""
    try:
        with open(os.path.join(HERE, "data", "broward", "status.json")) as f:
            st = json.load(f)
    except (OSError, ValueError):
        return ""
    if st.get("ok", True):
        return ""
    when = (st.get("data_collected_at") or "an earlier pull")[11:16] or "an earlier pull"
    return f"Broward dashboard failed; its numbers are carried over from {when}"


def main():
    os.makedirs(RUNS, exist_ok=True)
    now_local = datetime.now()
    now = datetime.now(timezone.utc)
    run_id = now_local.strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(RUNS, run_id)
    if os.path.exists(dest):
        raise SystemExit(f"{dest} already exists - refusing to overwrite")
    os.makedirs(dest)

    totals = workbook_totals()
    ft = feed_time()

    # data tables
    shutil.copytree(os.path.join(HERE, "data"), os.path.join(dest, "data"),
                    ignore=shutil.ignore_patterns("last_run.json"))
    # reports
    if os.path.isdir(REPORTS):
        shutil.copytree(REPORTS, os.path.join(dest, "Reports"))
    # code used
    code_dir = os.path.join(dest, "code")
    os.makedirs(code_dir)
    for fn in KEEP:
        src = os.path.join(HERE, fn)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(code_dir, fn))

    # raw feeds, zipped
    with zipfile.ZipFile(os.path.join(dest, "raw_feeds.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        for sub in ("tqv",):
            d = os.path.join(HERE, "raw", sub)
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if fn.endswith(".json"):
                    z.write(os.path.join(d, fn), f"{sub}/{fn}")
        for fn in ("sites.json", "collect_log.json"):
            p = os.path.join(HERE, "raw", fn)
            if os.path.exists(p):
                z.write(p, fn)

    # manifest
    files = []
    for root, _, names in os.walk(dest):
        for n in sorted(names):
            p = os.path.join(root, n)
            if os.path.basename(p) == "manifest.json":
                continue
            files.append({"path": os.path.relpath(p, dest), "bytes": os.path.getsize(p),
                          "sha256": sha(p)})
    manifest = {"run_id": run_id,
                "created_local": now_local.isoformat(timespec="seconds"),
                "created_utc": now.isoformat(timespec="seconds"),
                "feed_time": ft, "counties": 67, "totals": totals,
                "files": files}
    with open(os.path.join(dest, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)

    # append-only index
    new = not os.path.exists(INDEX)
    row = {"run_id": run_id, "created_local": now_local.isoformat(timespec="seconds"),
           "created_utc": now.isoformat(timespec="seconds"),
           "feed_time": ft, **{k: totals[k] for k in ("ballots", "mail", "early",
                                                      "election_day", "provisional",
                                                      "eligible", "turnout_pct")},
           "note": broward_note()}
    with open(INDEX, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(row))
        if new:
            w.writeheader()
        w.writerow(row)

    latest = os.path.join(RUNS, "latest")
    if os.path.islink(latest):
        os.unlink(latest)
    if not os.path.exists(latest):
        os.symlink(dest, latest)

    print(f"  archived -> runs/{run_id}/")
    print(f"  files: {len(files)}  totals: {totals['ballots']:,} ballots / "
          f"{totals['eligible']:,} eligible = {totals['turnout_pct']:.2f}%")


if __name__ == "__main__":
    main()
