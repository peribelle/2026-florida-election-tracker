#!/usr/bin/env python3
"""Shared bits for the projections pullers.

Every projections_*.py writes its own predictions_<source>.csv / calls_<source>.csv
into the snapshot directory it is handed. projections.py merges them, so one
adapter failing simply means one source's file is missing.

Kept deliberately small: map loading, race naming, CSV writing.
"""
import csv, json, os, re
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
MAP_PATH = os.path.join(HERE, "raw", "projection_map.json")

PRED_FIELDS = ["fetched_utc", "source", "race_key", "race", "office", "district",
               "candidate", "party", "win_probability", "price_cents", "bid_cents",
               "ask_cents", "volume", "source_updated_at", "source_url"]
CALL_FIELDS = ["fetched_utc", "source", "race_key", "race", "office", "district",
               "candidate", "party", "winner", "called_at_utc", "votes", "percent",
               "precincts_in", "precincts_total", "source_url"]


def load_map():
    with open(MAP_PATH) as f:
        return json.load(f)


def now_utc():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def race_key_from_slug(slug):
    """florida-us-house-13-general-election -> FL-H13"""
    if "governor" in slug:
        return "FL-GOV"
    if "us-senate" in slug:
        return "FL-SEN"
    m = re.search(r"us-house-(\d+)-", slug)
    if m:
        return "FL-H%02d" % int(m.group(1))
    return "FL-" + slug.upper()


def race_meta(race_key, cfg=None):
    """(race, office, district) for a race key, from the map with a sane fallback."""
    names = (cfg or load_map()).get("race_names", {})
    if race_key in names:
        n = names[race_key]
        return n["race"], n["office"], n["district"]
    m = re.match(r"^FL-H(\d+)$", race_key)
    if m:
        return "US House %d" % int(m.group(1)), "US House", str(int(m.group(1)))
    return race_key, "", ""


def write_rows(dest, name, rows, fields):
    if not rows:
        return 0
    path = os.path.join(dest, name)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
