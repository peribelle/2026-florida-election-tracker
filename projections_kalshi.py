#!/usr/bin/env python3
"""Kalshi -- Florida race win probabilities priced by the market.

Predictions only. Kalshi's settled `result` field would also give a winner,
but calls come from DDHQ alone so there is one authority for that column.

Prices are dollars (0.85) and are written as probability 0.85 / price_cents 85.
The list endpoint strips price fields, so each event is re-fetched with
`with_nested_markets=true`: one request per event instead of one per market.

Usage: projections_kalshi.py <snapshot-dir>
"""
import json, os, re, sys
import requests

from projection_common import (PRED_FIELDS, load_map, now_utc, race_meta,
                               to_float, write_rows)

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
H = {"User-Agent": UA, "Accept": "application/json"}
SUFFIX_PARTY = {"R": "GOP", "D": "DEM", "I": "NPA", "L": "LPF", "G": "GRE"}
PARTY_WORDS = {"republican": "GOP", "democratic": "DEM", "democrat": "DEM",
               "libertarian": "LPF", "green": "GRE", "independent": "NPA",
               "no party": "NPA"}


def party_of(m):
    """Party from subtitle (":: Democratic"), falling back to the ticker suffix.

    Series differ: SENATEFLS uses "Republican party:: Republican party" while
    KXFLCFO uses ":: Democratic", and its tickers end -ATAD/-BING rather than
    -R/-D, so the suffix is only a last resort.
    """
    sub = m.get("subtitle") or ""
    tail = (sub.rsplit("::", 1)[-1] if "::" in sub else sub).strip()
    tail = re.sub(r"\s*party\s*$", "", tail, flags=re.I).lower()
    for word, code in PARTY_WORDS.items():
        if word in tail:
            return code
    suffix = (m.get("ticker") or "").rsplit("-", 1)[-1].upper()
    return SUFFIX_PARTY.get(suffix, suffix)


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


def event_tickers(session, base, series):
    j, err = get(session, f"{base}/markets", {"series_ticker": series, "limit": 200})
    if not j:
        return [], err
    return sorted({m.get("event_ticker") for m in j.get("markets", []) if m.get("event_ticker")}), None


def price_of(m):
    """Prefer the last trade, else the bid/ask midpoint -- whichever exists."""
    last = to_float(m.get("last_price_dollars"))
    bid = to_float(m.get("yes_bid_dollars"))
    ask = to_float(m.get("yes_ask_dollars"))
    if last is not None and last > 0:
        return last, bid, ask
    if bid is not None and ask is not None and (bid > 0 or ask > 0):
        return (bid + ask) / 2, bid, ask
    return (bid if bid is not None else last), bid, ask


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else "."
    cfg = load_map()
    kcfg = cfg.get("kalshi", {})
    base = kcfg.get("base", "https://api.elections.kalshi.com/trade-api/v2").rstrip("/")
    session = requests.Session()

    rows, failures, empty, seen_events = [], {}, [], 0
    for entry in kcfg.get("series", []):
        race_key, series = entry["race_key"], entry["series"]
        race_name, office, district = race_meta(race_key, cfg)

        events, err = event_tickers(session, base, series)
        if err:
            failures[f"{race_key}/{series}"] = err
            continue
        if not events:
            empty.append(f"{race_key}/{series}")   # listed but nothing trading
            continue

        for et in events:
            j, err = get(session, f"{base}/events/{et}", {"with_nested_markets": "true"})
            if not j:
                failures[f"{race_key}/{et}"] = err
                continue
            seen_events += 1
            for m in (j.get("event") or {}).get("markets", []):
                if m.get("status") not in (None, "active"):
                    continue
                price, bid, ask = price_of(m)
                if price is None:
                    continue
                rows.append({
                    "fetched_utc": now_utc(), "source": "kalshi", "race_key": race_key,
                    "race": race_name, "office": office, "district": district,
                    "candidate": m.get("yes_sub_title") or "",
                    "party": party_of(m),
                    "win_probability": round(price, 4),
                    "price_cents": round(price * 100, 2),
                    "bid_cents": round(bid * 100, 2) if bid is not None else "",
                    "ask_cents": round(ask * 100, 2) if ask is not None else "",
                    "volume": m.get("volume_fp") or "",
                    "source_updated_at": m.get("updated_time") or "",
                    "source_url": f"{base}/events/{et}",
                })

    n = write_rows(dest, "predictions_kalshi.csv", rows, PRED_FIELDS)
    print(f"  kalshi: {n} market rows across {len({r['race_key'] for r in rows})} races "
          f"({seen_events} events)")
    if empty:
        print(f"  kalshi: {len(empty)} series with no open market -> {empty[:3]}")
    if failures:
        print(f"  kalshi failures: {len(failures)} -> {list(failures.items())[:3]}")

    json.dump({"series_configured": len(kcfg.get("series", [])),
               "events_ok": seen_events, "rows": n,
               "races": len({r["race_key"] for r in rows}),
               "empty_series": empty, "failures": failures},
              open(os.path.join(dest, "kalshi_summary.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
