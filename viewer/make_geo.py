#!/usr/bin/env python3
"""Build viewer/fl_counties.json (Florida county outlines for the map).

Source: US Census cartographic boundaries as packaged in us-atlas (TopoJSON, public domain):
    https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json

One-time step. The viewer reads the output; nothing here runs at refresh time.

    .venv/bin/python -I viewer/make_geo.py /path/to/counties-10m.json
"""
import json, math, os, sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fl_counties.json")
WIDTH = 1000          # viewBox width; height follows the state's aspect ratio
EPS = 0.45            # Douglas-Peucker tolerance, in viewBox units


def decode_arcs(topo):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx; y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs


def ring_points(arcs, idxs):
    pts = []
    for i in idxs:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a if not pts else a[1:])
    return pts


def albers(lon, lat, p1=29.5, p2=45.5, lat0=37.5, lon0=-96.0):
    """Albers equal-area conic (the usual US projection). Returns (x, y) with y pointing up."""
    r = math.radians
    n = (math.sin(r(p1)) + math.sin(r(p2))) / 2
    c = math.cos(r(p1)) ** 2 + 2 * n * math.sin(r(p1))
    rho0 = math.sqrt(c - 2 * n * math.sin(r(lat0))) / n
    rho = math.sqrt(c - 2 * n * math.sin(r(lat))) / n
    th = n * r(lon - lon0)
    return rho * math.sin(th), rho0 - rho * math.cos(th)


def dp(points, eps):
    """Douglas-Peucker, iterative."""
    if len(points) < 4:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]; bx, by = points[b]
        dx, dy = bx - ax, by - ay
        den = math.hypot(dx, dy) or 1e-12
        best, idx = 0, None
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / den
            if d > best:
                best, idx = d, i
        if idx is not None and best > eps:
            keep[idx] = True
            stack.append((a, idx)); stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def dp_ring(points, eps):
    """Simplify a closed ring. Its endpoints coincide, so split at the farthest point first."""
    if points[0] == points[-1]:
        points = points[:-1]
    if len(points) < 4:
        return points
    x0, y0 = points[0]
    m = max(range(len(points)), key=lambda i: (points[i][0] - x0) ** 2 + (points[i][1] - y0) ** 2)
    a = dp(points[:m + 1], eps)
    b = dp(points[m:] + [points[0]], eps)
    return a[:-1] + b[:-1]


def area_centroid(ring):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        cr = x0 * y1 - x1 * y0
        a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr
    a /= 2
    return (cx / (6 * a), cy / (6 * a), abs(a)) if a else (ring[0][0], ring[0][1], 0)


def main(src):
    topo = json.load(open(src))
    arcs = decode_arcs(topo)
    geoms = [g for g in topo["objects"]["counties"]["geometries"] if str(g["id"]).startswith("12")]
    # polygons[fips] = list of rings-lists (each polygon = [outer, *holes]) in projected coords
    projected, xs, ys = {}, [], []
    for g in geoms:
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        out = []
        for poly in polys:
            rings = []
            for ring in poly:
                pts = [albers(lon, lat) for lon, lat in ring_points(arcs, ring)]
                rings.append(pts)
                xs += [p[0] for p in pts]; ys += [p[1] for p in pts]
            out.append(rings)
        projected[str(g["id"])] = (g["properties"]["name"], out)
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    k = (WIDTH - 20) / (maxx - minx)
    height = round((maxy - miny) * k + 20)
    tf = lambda p: (10 + (p[0] - minx) * k, 10 + (maxy - p[1]) * k)   # flip y for SVG

    counties = {}
    for fips, (name, polys) in sorted(projected.items()):
        d, best = [], (0, 0, 0)
        for rings in polys:
            for ri, ring in enumerate(rings):
                pts = dp_ring([tf(p) for p in ring], EPS)
                if len(pts) < 3:
                    continue
                d.append("M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + "Z")
                if ri == 0:
                    cx, cy, ar = area_centroid(pts)
                    if ar > best[2]:
                        best = (cx, cy, ar)
        counties[fips] = {"name": name, "d": "".join(d), "c": [round(best[0], 1), round(best[1], 1)]}
    out = {"viewBox": [WIDTH, height], "counties": counties,
           "source": "US Census cartographic boundaries via us-atlas 3.0.1 (public domain); Albers equal-area conic"}
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(counties)} counties, viewBox {WIDTH}x{height}, {os.path.getsize(OUT):,} bytes -> {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
