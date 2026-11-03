#!/usr/bin/env python3
"""DDHQ Votes -- Florida forecast win probabilities and race calls.

Both come out of the same page, so one request per race serves both outputs:

  predictions : the forecast model's win probability per candidate
                (last point of the candidate-level timeseries)
  calls       : raceData.toplineResults[].winner / .called_at -- DDHQ's call

The race list is discovered from DDHQ's forecast index pages rather than
hardcoded, so a race added or dropped upstream shows up here on its own.

The payload is the Next.js flight stream (requested with `RSC: 1`, which is
~4x smaller than the rendered HTML). It is NOT a single JSON document: it is
a stream of component props. Every extract below therefore locates a marker
and uses raw_decode() on the object that follows it. Never take the first
matching key in the blob -- a forecast page embeds the whole cycle, and
positional parsing silently attaches another race's numbers to this one.

Usage: projections_ddhq.py <snapshot-dir>
"""
import gzip, json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
import requests

from projection_common import (CALL_FIELDS, PRED_FIELDS, load_map, now_utc,
                               race_key_from_slug, race_meta, write_rows)

BASE_DEFAULT = "https://votes.decisiondeskhq.com"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
H_HTML = {"User-Agent": UA, "Accept": "text/html"}
H_RSC = {"User-Agent": UA, "Accept": "text/x-component", "RSC": "1"}

DEC = json.JSONDecoder()


def _decode_after(text, marker, opener="{"):
    """Find `marker`, then raw_decode the JSON value starting at the next `opener`."""
    i = text.find(marker)
    if i < 0:
        return None
    j = text.find(opener, i + len(marker))
    if j < 0:
        return None
    try:
        return DEC.raw_decode(text, j)[0]
    except ValueError:
        return None


def _timeseries(text, kind_key):
    """Every non-empty timeseries array whose points carry `kind_key`."""
    out = []
    for m in re.finditer(r'"timeseries"\s*:\s*\[', text):
        try:
            arr = DEC.raw_decode(text, m.end() - 1)[0]
        except ValueError:
            continue
        if arr and isinstance(arr[0], dict) and kind_key in arr[0]:
            out.append(arr)
    return out


def current_forecast(text, cand_ids):
    """Latest win probability per candidate id.

    Prefers the candidate-level series and matches on candidate ids so a page
    carrying several races can't hand back the wrong one; falls back to the
    party-level series when only that exists.
    """
    best = None
    for arr in _timeseries(text, "candidates"):
        last = arr[-1]
        ids = {c.get("cand_id") for c in last.get("candidates", [])}
        if cand_ids and not (ids & cand_ids):
            continue
        stamp = last.get("date") or ""
        if best is None or stamp > best[0]:
            best = (stamp, {c["cand_id"]: c.get("win_probability")
                            for c in last.get("candidates", [])
                            if c.get("cand_id") is not None})
    if best:
        return best[1], best[0], "candidate"

    best = None
    for arr in _timeseries(text, "parties"):
        last = arr[-1]
        stamp = last.get("date") or ""
        if best is None or stamp > best[0]:
            best = (stamp, {p.get("name", "").lower(): p.get("winProbability")
                            for p in last.get("parties", [])})
    if best:
        return best[1], best[0], "party"
    return {}, "", None


def discover(session, cfg):
    """Florida race slugs advertised on DDHQ's forecast index pages."""
    base = cfg.get("base", BASE_DEFAULT).rstrip("/")
    prefix = cfg.get("slug_prefix", "florida-")
    slugs = {}
    for page in cfg.get("index_pages", []):
        try:
            r = session.get(base + page, headers=H_HTML, timeout=60)
            if r.status_code != 200:
                print(f"  ! index {page}: HTTP {r.status_code}")
                continue
        except Exception as e:
            print(f"  ! index {page}: {str(e)[:60]}")
            continue
        for slug in re.findall(r'/races/\d{4}-\d{2}-\d{2}/(%s[a-z0-9-]+)/forecast'
                               % re.escape(prefix), r.text):
            slugs[slug] = True
    return sorted(slugs)


def parse_race(slug, text, cfg):
    """-> (prediction rows, call rows) for one race page."""
    dcfg = cfg.get("ddhq", {})
    init = _decode_after(text, '"initialData":')
    race = (init or {}).get("raceData") or _decode_after(text, '"raceData":') or {}
    cands = (init or {}).get("candidates") or []

    race_key = race_key_from_slug(slug)
    race_name, office, district = race_meta(race_key, cfg)
    url = (f"{dcfg.get('base', BASE_DEFAULT).rstrip('/')}/races/"
           f"{cfg.get('election_date')}/{slug}/forecast")
    stamp = now_utc()
    updated = race.get("lastUpdated") or ""

    # candidate metadata by id, so names/parties survive into both outputs
    meta = {}
    for c in cands:
        meta[c.get("id")] = {
            "name": " ".join(x for x in [c.get("firstName"), c.get("lastName")] if x).strip(),
            "party": (c.get("party") or {}).get("abbrev", ""),
        }

    probs, as_of, basis = current_forecast(text, set(meta))
    preds = []
    for cid, p in probs.items():
        if cid is None:
            continue
        m = meta.get(cid, {})
        if basis == "party":
            # party-level fallback keys on party name, not candidate id
            m = {"name": str(cid), "party": ""}
        preds.append({
            "fetched_utc": stamp, "source": "ddhq", "race_key": race_key,
            "race": race_name, "office": office, "district": district,
            "candidate": m.get("name", ""), "party": m.get("party", ""),
            "win_probability": p, "price_cents": "", "bid_cents": "", "ask_cents": "",
            "volume": "", "source_updated_at": as_of or updated, "source_url": url,
        })

    turnout = race.get("turnout") or {}
    calls = []
    for t in race.get("toplineResults") or []:
        cid = t.get("candId")
        name = meta.get(cid, {}).get("name") or " ".join(
            x for x in [t.get("firstName"), t.get("lastName")] if x).strip()
        calls.append({
            "fetched_utc": stamp, "source": "ddhq", "race_key": race_key,
            "race": race_name, "office": office, "district": district,
            "candidate": name, "party": (t.get("party") or {}).get("abbrev", ""),
            "winner": bool(t.get("winner")),
            "called_at_utc": t.get("called_at") or "",
            "votes": t.get("votes"), "percent": t.get("percent"),
            "precincts_in": turnout.get("precincts_in"),
            "precincts_total": turnout.get("precincts_tot"),
            "source_url": url,
        })
    return preds, calls, (race.get("certified"), race.get("totalVotes"))


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else "."
    cfg = load_map()
    dcfg = cfg.get("ddhq", {})
    session = requests.Session()

    slugs = discover(session, dcfg)
    print(f"  ddhq: {len(slugs)} florida races discovered")
    if not slugs:
        raise SystemExit("ddhq: discovery returned nothing")

    rawdir = os.path.join(dest, "raw")
    os.makedirs(rawdir, exist_ok=True)

    def fetch(slug):
        url = f"{dcfg.get('base', BASE_DEFAULT).rstrip('/')}/races/{cfg.get('election_date')}/{slug}/forecast"
        last = ""
        for _ in range(3):
            try:
                r = requests.get(url, headers=H_RSC, timeout=60)
                if r.status_code == 200:
                    return slug, r.text, None
                last = f"HTTP {r.status_code}"
                if r.status_code == 404:
                    break
            except Exception as e:
                last = str(e)[:60]
        return slug, None, last

    preds, calls, failures, certified = [], [], {}, 0
    with ThreadPoolExecutor(6) as ex:
        for slug, text, err in ex.map(fetch, slugs):
            if not text:
                failures[slug] = err
                continue
            with gzip.open(os.path.join(rawdir, f"ddhq_{slug}.txt.gz"), "wt",
                           encoding="utf-8") as f:
                f.write(text)
            try:
                p, c, (cert, _tv) = parse_race(slug, text, cfg)
                preds.extend(p)
                calls.extend(c)
                certified += 1 if cert else 0
            except Exception as e:
                failures[slug] = f"parse: {str(e)[:60]}"

    npred = write_rows(dest, "predictions_ddhq.csv", preds, PRED_FIELDS)
    ncall = write_rows(dest, "calls_ddhq.csv", calls, CALL_FIELDS)
    called = sum(1 for c in calls if c["winner"])
    with_probs = len({p["race_key"] for p in preds})

    print(f"  ddhq: {len(slugs) - len(failures)}/{len(slugs)} races parsed, "
          f"{npred} candidate forecasts across {with_probs} races, {ncall} call rows "
          f"({called} called)")
    if failures:
        print(f"  ddhq failures: {len(failures)} -> {list(failures.items())[:3]}")

    json.dump({"races_discovered": len(slugs),
               "races_ok": len(slugs) - len(failures),
               "races_with_forecast": with_probs,
               "prediction_rows": npred, "call_rows": ncall,
               "called_candidates": called, "races_certified": certified,
               "failures": failures},
              open(os.path.join(dest, "ddhq_summary.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
