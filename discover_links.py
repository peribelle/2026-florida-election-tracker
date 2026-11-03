#!/usr/bin/env python3
"""Re-discover county results links by scraping each Supervisor of Elections site.

County homepages point at their current election-night results page. Those links
change when a county stands up its general-election site, so this runs before the
results phase (and again periodically) instead of relying on a frozen config.

Validates every candidate URL by checking that the page is the 2026 general
(looks for 11/3/2026), then merges into raw/enr_ids.json.
"""
import json, os, re
from concurrent.futures import ThreadPoolExecutor
import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "raw", "enr_ids.json")
SITES = os.path.join(HERE, "raw", "sites.json")
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
     "Accept": "text/html"}
PATTERNS = [
    (re.compile(r"https?://enr\.electionsfl\.org/([A-Z]{3})/(\d+)"), lambda m: ("https://enr.electionsfl.org", m.group(1), m.group(2))),
    (re.compile(r"https?://results\.enr\.clarityelections\.com/(FL/[A-Za-z_%\-]+)/(\d+)"), lambda m: ("https://results.enr.clarityelections.com", m.group(1), m.group(2))),
    (re.compile(r"https?://([a-z0-9.\-]*browardvotes\.gov)/ENR/([A-Za-z0-9_]+)/(\d+)"), lambda m: (f"https://{m.group(1)}", m.group(2), m.group(3))),
]


def is_general(text):
    return ("11/3/2026" in text or "11/03/2026" in text
            or ("November 3, 2026" in text and "General" in text))


def check(url):
    try:
        r = requests.get(url, headers=H, timeout=25)
        if r.status_code == 200 and is_general(r.text):
            return True
    except Exception:
        pass
    return False


def from_homepage(args):
    code, site = args
    try:
        r = requests.get(site, headers=H, timeout=25, allow_redirects=True)
        if r.status_code != 200:
            return code, []
    except Exception:
        return code, []
    soup = BeautifulSoup(r.text, "lxml")
    cands = []
    for a in soup.find_all("a", href=True):
        href = requests.compat.urljoin(r.url, a["href"])
        for pat, norm in PATTERNS:
            m = pat.search(href)
            if m:
                base, ident, eid = norm(m)
                cands.append({"base": base, "key": ident, "id": eid})
                break
    # de-dupe, newest id first
    seen, out = set(), []
    for c in sorted(cands, key=lambda c: -int(c["id"])):
        sig = (c["base"], c["key"])
        if sig in seen:
            continue
        seen.add(sig)
        out.append(c)
    return code, out


def url_for(cfg, code):
    base = cfg["base"].rstrip("/")
    key = cfg.get("key", code)
    return f"{base}/{key}/{cfg['id']}/Summary/"


def main():
    sites = {k: v["site"] for k, v in json.load(open(SITES)).items()}
    have = {}
    if os.path.exists(CFG):
        raw = json.load(open(CFG))
        for k, v in raw.items():
            have[k] = v if isinstance(v, dict) else {"id": str(v),
                                                     "base": "https://enr.electionsfl.org",
                                                     "key": k}

    with ThreadPoolExecutor(12) as ex:
        found = dict(ex.map(from_homepage, sorted(sites.items())))

    added, refreshed = 0, 0
    for code, cands in found.items():
        for c in cands:
            cfg = {"base": c["base"], "key": c["key"], "id": c["id"]}
            if not check(url_for(cfg, code)):
                continue
            if code in have:
                if have[code] != cfg:
                    have[code] = cfg
                    refreshed += 1
            else:
                have[code] = cfg
                added += 1
            break

    json.dump(have, open(CFG, "w"), indent=1, sort_keys=True)
    missing = [c for c in sites if c not in have]
    print(f"  discovery: +{added} new, {refreshed} updated, {len(have)}/67 usable")
    if missing:
        print(f"  no 2026 general ENR page yet: {', '.join(sorted(missing))}")


if __name__ == "__main__":
    main()
