#!/usr/bin/env python3
"""Polymarket -- Florida race win probabilities priced by the market.

Predictions only, for the same reason as the Kalshi adapter: one authority
(DDHQ) owns the calls column, the markets only contribute probabilities.

Polymarket's gamma API returns `outcomes` and `outcomePrices` as JSON strings
inside the JSON ("[\\"Yes\\",\\"No\\"]"), which is why they get re-parsed here.
Events also carry empty "Option A".."Option J" placeholder markets: they have
zero volume and are dropped, otherwise they'd pollute the output with 0%.

Usage: projections_polymarket.py <snapshot-dir>
"""
import json, os, sys
import requests

from projection_common import (PRED_FIELDS, load_map, now_utc, race_meta,
                               to_float, write_rows)

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
H = {"User-Agent": UA, "Accept": "application/json"}
PARTY_WORDS = {"republican": "GOP", "democrat": "DEM"}


def jload(s):
    try:
        return json.loads(s) if isinstance(s, str) else (s or [])
    except ValueError:
        return []


def get(session, url, params=None, tries=3):
    last = ""
    for _ in range(tries):
        try:
            r = session.get(url, headers=H, params=params, timeout=40)
            if r.status_code == 200:
                return r.json(), None
            last = f"HTTP {r.status_code}"
            if r.status_code == 404:
                break
        except Exception as e:
            last = str(e)[:60]
    return None, last


def party_of(question):
    q = (question or "").lower()
    for word, code in PARTY_WORDS.items():
        if word in q:
            return code
    return ""


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else "."
    cfg = load_map()
    pcfg = cfg.get("polymarket", {})
    base = pcfg.get("base", "https://gamma-api.polymarket.com").rstrip("/")
    session = requests.Session()

    rows, failures, skipped = [], {}, 0
    for entry in pcfg.get("events", []):
        race_key, slug = entry["race_key"], entry["slug"]
        race_name, office, district = race_meta(race_key, cfg)

        j, err = get(session, f"{base}/events", {"slug": slug})
        if err or not j:
            failures[race_key] = err or "not found"
            continue
        event = j[0] if isinstance(j, list) and j else j

        for m in event.get("markets", []):
            question = m.get("question") or ""
            volume = to_float(m.get("volume")) or 0.0
            outcomes = jload(m.get("outcomes"))
            prices = [to_float(p) for p in jload(m.get("outcomePrices"))]
            if volume <= 0 or not outcomes or not prices:
                skipped += 1
                continue  # placeholder "Option A".."Option J" markets
            if "yes" in [str(o).lower() for o in outcomes]:
                idx = [str(o).lower() for o in outcomes].index("yes")
            else:
                idx = 0
            price = prices[idx] if idx < len(prices) else None
            if price is None:
                skipped += 1
                continue
            rows.append({
                "fetched_utc": now_utc(), "source": "polymarket", "race_key": race_key,
                "race": race_name, "office": office, "district": district,
                "candidate": "", "party": party_of(question),
                "win_probability": round(price, 4),
                "price_cents": round(price * 100, 2), "bid_cents": "", "ask_cents": "",
                "volume": round(volume, 2),
                "source_updated_at": m.get("updatedAt") or "",
                "source_url": f"https://polymarket.com/event/{slug}",
            })

    n = write_rows(dest, "predictions_polymarket.csv", rows, PRED_FIELDS)
    print(f"  polymarket: {n} market rows across {len({r['race_key'] for r in rows})} races "
          f"({skipped} empty markets skipped)")
    if failures:
        print(f"  polymarket failures: {len(failures)} -> {list(failures.items())[:3]}")

    json.dump({"events_configured": len(pcfg.get("events", [])), "rows": n,
               "races": len({r["race_key"] for r in rows}),
               "empty_markets_skipped": skipped, "failures": failures},
              open(os.path.join(dest, "polymarket_summary.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
