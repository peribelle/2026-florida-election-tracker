/* ---------- chart kit: small generic charts the new views are assembled from ----------
   All of them draw into `host` at width `w`, follow the shared look (thin marks, hairline grid, text halos),
   and give every mark a hover tooltip. Tooltips take a function returning content from tipContent(). */

/* horizontal bars; rows: [{label, sub, value, color, hi, tip, click}]. Negative values grow left from zero. */
function kitBars(host, w, rows, o = {}) {
  const rh = o.rowH || 30, bt = Math.min(o.barH || 16, 24), narrow = w < 480;
  const labW = o.labelW ?? (narrow ? Math.min(118, w * .34) : Math.min(210, w * .32));
  const m = { l: labW, r: o.rightPad ?? 78, t: o.ref ? 24 : 6, b: o.axis === false ? 6 : 26 };
  const H = m.t + rows.length * rh + m.b, iw = Math.max(40, w - m.l - m.r), fmt = o.fmt || (v => fComp(v));
  const vals = rows.map(r => r.value), hiV = Math.max(...vals, o.min0 ? 0 : 1e-9), loV = Math.min(0, ...vals);
  const tk = niceTicks(Math.max(o.max ?? hiV, hiV) * 1.02, 4, loV < 0 ? loV : 0);
  const top = o.max ?? tk.max, lo = loV < 0 ? Math.min(loV, tk.ticks[0]) : 0;
  const x = linear(lo, top, m.l, m.l + iw), svg = svgBox(w, H); host.append(svg);
  if (o.axis !== false) axisX(svg, x, tk.ticks.filter(t => t <= top + 1e-9 && t >= lo - 1e-9), m.t, H - m.b, o.axisFmt || fmt, H - m.b + 17);
  const x0 = x(0);
  svg.append(s('line', { class: 'axisl', x1: crisp(x0), x2: crisp(x0), y1: m.t, y2: H - m.b }));
  rows.forEach((r, i) => {
    const y = m.t + i * rh, cy = y + rh / 2, neg = r.value < 0, xv = x(r.value), bw = Math.abs(xv - x0);
    svg.append(s('text', { class: 't-lab', x: m.l - 10, y: cy + (r.sub ? -2 : 4.5), 'text-anchor': 'end', style: { fontWeight: r.hi ? 900 : 700 } }, fitText(r.label, 13, r.hi ? 900 : 700, m.l - (r.dot ? 34 : 16))));
    if (r.sub) svg.append(s('text', { class: 't-axis', x: m.l - 10, y: cy + 12, 'text-anchor': 'end' }, fitText(r.sub, 12, 600, m.l - (r.dot ? 34 : 16))));
    if (r.dot) svg.append(s('circle', { cx: 9, cy: cy + (r.sub ? 0 : 0), r: 5.5, fill: r.dot, stroke: 'var(--surface)', 'stroke-width': 1.5 }));
    const bar = s('path', { class: 'mark' + (r.click ? ' clickable' : ''), d: rrect(neg ? xv : x0, cy - bt / 2, Math.max(bw, r.value === 0 ? 0 : .5), bt, neg ? { tl: 4, bl: 4 } : { tr: 4, br: 4 }),
      fill: r.color || 'var(--early)', ...(r.hi ? { stroke: 'var(--ink)', 'stroke-width': 2 } : {}) });
    const hit = s('rect', { class: 'hit', x: 0, y, width: w, height: rh, style: { cursor: r.click ? 'pointer' : 'default' } });
    if (r.tip) hover(hit, r.tip, { enter: () => bar.classList.add('lift'), leave: () => bar.classList.remove('lift') });
    if (r.click) hit.addEventListener('click', r.click);
    svg.append(bar, s('text', { class: 't-val', x: neg ? xv - 7 : xv + 7, y: cy + 4.5, 'text-anchor': neg ? 'end' : 'start' }, r.text ?? fmt(r.value)), hit);
  });
  if (o.ref) {
    const rx = crisp(x(o.ref.value));
    svg.append(s('line', { class: 'refl', x1: rx, x2: rx, y1: m.t - 6, y2: H - m.b }), s('text', { class: 't-note', x: rx + 6, y: m.t - 10 }, o.ref.label));
  }
  return svg;
}

/* stacked horizontal bars; rows: [{label, sub, parts: [{label, color, value}], tip, click, hi}]; mode 'share' makes every bar 100% */
function kitStack(host, w, rows, o = {}) {
  const share = o.mode === 'share', rh = o.rowH || 34, bt = Math.min(o.barH || 20, 24), narrow = w < 480;
  const labW = o.labelW ?? (narrow ? Math.min(112, w * .32) : Math.min(190, w * .3)), m = { l: labW, r: o.rightPad ?? 64, t: 4, b: share ? 6 : 26 };
  const H = m.t + rows.length * rh + m.b, iw = Math.max(40, w - m.l - m.r);
  const tot = r => sum(r.parts.map(p => p.value)), maxV = share ? 100 : Math.max(...rows.map(tot), 1);
  const tk = niceTicks(maxV, 4), x = linear(0, share ? 100 : tk.max, m.l, m.l + iw), svg = svgBox(w, H); host.append(svg);
  if (!share) axisX(svg, x, tk.ticks, m.t, H - m.b, fComp, H - m.b + 17);
  svg.append(s('line', { class: 'axisl', x1: crisp(m.l), x2: crisp(m.l), y1: m.t, y2: H - m.b }));
  rows.forEach((r, i) => {
    const cy = m.t + i * rh + rh / 2, T = (share && o.fixed) ? Math.max(o.fixed, tot(r)) : tot(r) || 1, parts = r.parts.filter(p => p.value > 0);
    if (o.fixed) svg.append(s('rect', { x: m.l, y: cy - bt / 2, width: iw, height: bt, rx: 4, fill: 'var(--wash)' }));     // fixed total: the empty track shows what is not allocated
    svg.append(s('text', { class: 't-lab', x: m.l - 10, y: cy + (r.sub ? -2 : 4.5), 'text-anchor': 'end', style: { fontWeight: r.hi ? 900 : 700 } }, fitText(r.label, 13, r.hi ? 900 : 700, m.l - (r.dot ? 34 : 16))));
    if (r.sub) svg.append(s('text', { class: 't-axis', x: m.l - 10, y: cy + 12, 'text-anchor': 'end' }, fitText(r.sub, 12, 600, m.l - (r.dot ? 34 : 16))));
    if (r.dot) svg.append(s('circle', { cx: 9, cy, r: 5.5, fill: r.dot, stroke: 'var(--surface)', 'stroke-width': 1.5 }));
    let cur = m.l; const hit = s('rect', { class: 'hit', x: 0, y: cy - rh / 2, width: w, height: rh, style: { cursor: r.click ? 'pointer' : 'default' } });
    parts.forEach((p, j) => {
      const wpx = (share ? 100 * p.value / T : p.value) / (share ? 100 : tk.max) * iw, last = j === parts.length - 1, ww = Math.max(wpx - (last ? 0 : 2), 1);
      svg.append(s('path', { class: 'mark', d: rrect(cur, cy - bt / 2, ww, bt, last ? { tr: 4, br: 4 } : {}), fill: p.color, ...(r.hi ? { 'stroke-opacity': 0 } : {}) }));
      const lab = o.fmtPart ? o.fmtPart(p, T) : fPct(100 * p.value / T, 0);
      if (share && ww > textW(lab, 12, 800) + 14) svg.append(s('text', { class: 't-in' + labelInk(p.color), x: cur + ww / 2, y: cy + 4, 'text-anchor': 'middle' }, lab));
      cur += wpx;
    });
    if (r.tip) hover(hit, r.tip);
    if (r.click) hit.addEventListener('click', r.click);
    svg.append(s('text', { class: 't-val', x: share ? w - m.r + 8 : cur + 8, y: cy + 4.5 }, r.text ?? fComp(T)), hit);
  });
  return svg;
}

/* line chart on a shared x array; series: [{name, color, ys, width, dash}] (null leaves a gap). o.xFmt(x, i) labels ticks. */
function kitLines(host, w, xs, series, o = {}) {
  const H = o.height || clamp(Math.round(w * .34), 250, 360), n = xs.length, endL = o.endLabels !== false;
  const nameW = endL && w >= 520 ? Math.min(150, Math.max(82, ...series.map(se => textW(se.name, 12, 600) + 2))) : 0;
  const m = { l: 54, r: endL ? (w < 520 ? 70 : 46 + 14 + nameW) : 14, t: 26, b: 32 }, iw = w - m.l - m.r, ih = H - m.t - m.b;
  const ys = series.flatMap(se => se.ys.filter(v => v != null));
  const yMax = o.yMax ?? Math.max(...ys, 1) * 1.05, ty = niceTicks(yMax, 5, o.yMin ?? 0), y0 = ty.ticks[0];
  const y = linear(y0, ty.max, m.t + ih, m.t), x = n < 2 ? () => m.l + iw / 2 : linear(xs[0], xs[n - 1], m.l, m.l + iw);
  const svg = svgBox(w, H); host.append(svg), axisY(svg, y, ty.ticks, m.l, w - m.r, o.yFmt || fComp);
  const want = Math.max(2, Math.floor(iw / 78)), idxs = Array.from({ length: Math.min(want, n) }, (_, k) => n < 2 ? 0 : Math.round(k * (n - 1) / (Math.min(want, n) - 1 || 1)));
  [...new Set(idxs)].forEach(i => svg.append(s('text', { class: 't-axis', x: x(xs[i]), y: m.t + ih + 19, 'text-anchor': i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle' }, o.xFmt ? o.xFmt(xs[i], i) : String(xs[i]))));
  (o.vlines || []).forEach(v => svg.append(s('line', { x1: crisp(x(v.x)), x2: crisp(x(v.x)), y1: m.t - 4, y2: m.t + ih, stroke: 'var(--ink-3)', 'stroke-width': 1 }), s('text', { class: 't-note', x: x(v.x) + 5, y: m.t - 10 }, v.label)));
  if (o.ref) svg.append(s('line', { x1: m.l, x2: w - m.r, y1: crisp(y(o.ref.y)), y2: crisp(y(o.ref.y)), stroke: 'var(--ink-2)', 'stroke-width': 1.5 }), s('text', { class: 't-note', x: m.l + 6, y: y(o.ref.y) - 6 }, o.ref.label));
  const cross = s('line', { y1: m.t, y2: m.t + ih, stroke: 'var(--ink-3)', 'stroke-width': 1, opacity: 0 }); svg.append(cross);
  series.forEach(se => {
    let d = '', pen = false;
    se.ys.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    svg.append(s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': se.width || 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...(se.dash ? { 'stroke-dasharray': se.dash } : {}) }));
    if (n === 1) svg.append(s('circle', { cx: x(xs[0]), cy: y(se.ys[0]), r: 4.5, fill: se.color }));
  });
  if (endL) {
    const last = series.map(se => { let i = n - 1; while (i > 0 && se.ys[i] == null) i--; return i; });
    const py = series.map((se, k) => y(se.ys[last[k]] ?? 0)), lab = spread(py, 16);
    series.forEach((se, k) => {
      const v = se.ys[last[k]]; if (v == null) return;
      svg.append(s('circle', { cx: x(xs[last[k]]), cy: py[k], r: 4.5, fill: se.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
      const txt = (o.endFmt || o.yFmt || fComp)(v);
      svg.append(s('text', { class: 't-val', x: x(xs[last[k]]) + 10, y: lab[k] + 4 }, txt), ...(w < 520 ? [] : [s('text', { class: 't-axis', x: x(xs[last[k]]) + 14 + textW(txt, 13, 800), y: lab[k] + 4 }, fitText(se.name, 12, 600, nameW))]));
    });
  }
  const hit = s('rect', { class: 'hit', x: m.l, y: m.t, width: iw, height: ih });
  const at = e => { const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (w / r.width); let b = 0, bd = 1e18; xs.forEach((xv, i) => { const d = Math.abs(x(xv) - px); if (d < bd) { bd = d; b = i; } }); return b; };
  const tipFor = i => tipContent(o.tipHead ? o.tipHead(i) : String(xs[i]), series.filter(se => se.ys[i] != null).map(se => ({ color: se.color, label: se.name, value: se.tip ? se.tip(i) : (o.tipFmt || o.yFmt || fInt)(se.ys[i]) })), o.tipFoot && o.tipFoot(i));
  hover(hit, null, { move: e => { const i = at(e); cross.setAttribute('x1', crisp(x(xs[i]))); cross.setAttribute('x2', crisp(x(xs[i]))); cross.setAttribute('opacity', 1); tip.show(e, tipFor(i)); }, leave: () => cross.setAttribute('opacity', 0) });
  svg.append(hit);
  return svg;
}

/* scatter; pts: [{x, y, label?, color?, r?, hi?, tip, click}]. Returns the fit when o.fit is set. */
function kitScatter(host, w, pts, o = {}) {
  const H = o.height || clamp(Math.round(w * .6), 320, 460), m = { l: 56, r: 16, t: 18, b: 46 }, iw = w - m.l - m.r, ih = H - m.t - m.b;
  const X = pts.map(p => p.x), Y = pts.map(p => p.y), pad = (a, b) => [a, b];
  const xlo = Math.min(...X), xhi = Math.max(...X), ylo = Math.min(...Y), yhi = Math.max(...Y);
  const x = o.xLog ? logScale(Math.max(xlo * .85, 1e-9), xhi * 1.2, m.l, m.l + iw) : linear(xlo - (xhi - xlo) * .04, xhi + (xhi - xlo) * .04, m.l, m.l + iw);
  const yt = niceTicks(yhi, 5, Math.floor(ylo / 5) * 5 > ylo ? ylo : ylo - (yhi - ylo) * .06), y = o.yLog ? logScale(Math.max(ylo * .85, 1e-9), yhi * 1.2, m.t + ih, m.t) : linear(yt.ticks[0], Math.max(yt.max, yhi), m.t + ih, m.t);
  const svg = svgBox(w, H); host.append(svg);
  const xticks = o.xLog ? [1, 2.5, 5].flatMap(k => [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7].map(p => k * p)).filter(v => v >= x.inv(m.l) && v <= x.inv(m.l + iw)).sort((a, b) => a - b) : niceTicks(x.inv(m.l + iw), 6, x.inv(m.l)).ticks.filter(v => v >= x.inv(m.l) && v <= x.inv(m.l + iw));
  const yticks = o.yLog ? [1, 2.5, 5].flatMap(k => [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7].map(p => k * p)).filter(v => v >= y.inv(m.t + ih) && v <= y.inv(m.t)).sort((a, b) => a - b) : yt.ticks.filter(v => v >= y.inv(m.t + ih) - 1e-9 && v <= y.inv(m.t) + 1e-9);
  xticks.forEach(v => svg.append(s('line', { class: 'gridl', x1: crisp(x(v)), x2: crisp(x(v)), y1: m.t, y2: m.t + ih }), s('text', { class: 't-axis', x: x(v), y: m.t + ih + 17, 'text-anchor': 'middle' }, (o.xFmt || fComp)(v))));
  yticks.forEach(v => svg.append(s('line', { class: 'gridl', x1: m.l, x2: w - m.r, y1: crisp(y(v)), y2: crisp(y(v)) }), s('text', { class: 't-axis', x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, (o.yFmt || fComp)(v))));
  svg.append(s('line', { class: 'axisl', x1: m.l, x2: m.l, y1: m.t, y2: m.t + ih }), s('line', { class: 'axisl', x1: m.l, x2: w - m.r, y1: m.t + ih, y2: m.t + ih }));
  if (o.xLabel) svg.append(s('text', { class: 't-axis', x: m.l + iw / 2, y: H - 6, 'text-anchor': 'middle' }, o.xLabel));
  if (o.yLabel) svg.append(s('text', { class: 't-axis', x: m.l + 4, y: m.t - 6 }, o.yLabel));
  if (o.diag) svg.append(s('line', { x1: x(Math.max(xlo, ylo)), y1: y(Math.max(xlo, ylo)), x2: x(Math.min(xhi, yhi)), y2: y(Math.min(xhi, yhi)), stroke: 'var(--ink-3)', 'stroke-width': 1.5 }));
  let fit = null;
  if (o.fit && pts.length > 2) {
    const tx = o.xLog ? Math.log10 : v => v, ty2 = o.yLog ? Math.log10 : v => v;
    fit = linfit(pts.map(p => tx(p.x)), pts.map(p => ty2(p.y)));
    const f = v => o.yLog ? 10 ** (fit.intercept + fit.slope * tx(v)) : fit.intercept + fit.slope * tx(v);
    svg.append(s('line', { x1: x(xlo), x2: x(xhi), y1: y(f(xlo)), y2: y(f(xhi)), stroke: 'var(--ink-2)', 'stroke-width': 2, 'stroke-linecap': 'round' }),
      s('text', { class: 't-note', x: m.l + 10, y: m.t + 14 }, `r = ${fit.r.toFixed(2)}  ·  R² = ${fit.r2.toFixed(2)}`));
    pts.forEach(p => { p.res = ty2(p.y) - (fit.intercept + fit.slope * tx(p.x)); });
  }
  const P = pts.map(p => ({ ...p, px: x(p.x), py: y(p.y) })), ring = s('circle', { r: 9, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' });
  [...P].sort((a, b) => (a.hi ? 1 : 0) - (b.hi ? 1 : 0)).forEach(p => svg.append(s('circle', { cx: p.px, cy: p.py, r: p.r || 5, fill: p.color || 'var(--early)', stroke: p.hi ? 'var(--ink)' : 'var(--surface)', 'stroke-width': p.hi ? 2.5 : 2, opacity: p.hi ? 1 : (o.dim ? .75 : .92) })));
  const named = P.filter(p => p.label && (p.hi || p.always));
  const byRes = fit ? [...P].filter(p => p.label).sort((a, b) => Math.abs(b.res) - Math.abs(a.res)).slice(0, o.labelN ?? 4) : [];
  const placed = [], clear2 = b => b.x0 >= 2 && b.x1 <= w - 2 && b.y0 >= 2 && !placed.some(q => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
  [...new Set([...named, ...byRes])].forEach(p => {          // greedy label placement: first free corner wins, extras are dropped
    const tw = textW(p.label, 12, 700) + 2, rr = (p.r || 5) + 3, must = p.hi || p.always;
    const opts = [[1, -1], [1, 1], [-1, -1], [-1, 1]].map(([sx, sy]) => { const y0 = sy < 0 ? p.py - rr - 10 : p.py + rr, x0 = sx > 0 ? p.px + rr : p.px - rr - tw; return { sx, y: y0 + 10, b: { x0, x1: x0 + tw, y0, y1: y0 + 13 } }; });
    const pick = opts.find(c => clear2(c.b)) || (must ? opts[0] : null);
    if (!pick) return;
    placed.push(pick.b);
    svg.append(s('text', { class: 't-note', x: pick.sx > 0 ? pick.b.x0 : pick.b.x1 - 2, y: pick.y, 'text-anchor': pick.sx > 0 ? 'start' : 'end' }, p.label));
  });
  svg.append(ring);
  const hit = s('rect', { class: 'hit', x: m.l, y: m.t, width: iw, height: ih });
  const near = e => { const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (w / r.width), py = (e.clientY - r.top) * (H / r.height); let b = null, bd = 900; for (const p of P) { const d = (p.px - px) ** 2 + (p.py - py) ** 2; if (d < bd) { bd = d; b = p; } } return b; };
  hover(hit, null, { move: e => { const p = near(e); if (!p) { ring.setAttribute('opacity', 0); tip.hide(); return; } ring.setAttribute('cx', p.px); ring.setAttribute('cy', p.py); ring.setAttribute('opacity', 1); tip.show(e, p.tip ? p.tip() : tipContent(p.label || '', [{ label: 'x', value: String(p.x) }, { label: 'y', value: String(p.y) }])); }, leave: () => ring.setAttribute('opacity', 0) });
  hit.addEventListener('click', e => { const p = near(e); if (p && p.click) p.click(); });
  svg.append(hit);
  return fit;
}

/* the county map, generic: color(c) -> css color or null (not in this contest), legend: [{color,label}] */
function kitMap(host, w, o) {
  const W = Math.min(w, 720), k = W / GEO.viewBox[0], H = Math.round(GEO.viewBox[1] * k), bubbles = o.style === 'bubbles';
  const svg = svgBox(W, H); svg.style.maxWidth = W + 'px'; svg.style.margin = '0 auto'; host.append(svg);
  const sel = selection.i, g = s('g', { transform: `scale(${k})` }); svg.append(g);
  const aria = c => o.aria ? o.aria(c) : c.name;
  for (const [fips, geo] of Object.entries(GEO.counties)) {
    const c = BY_FIPS[fips]; if (!c) continue;
    const col = o.color(c);
    const p = s('path', { class: 'county', d: geo.d, 'fill-rule': 'evenodd', fill: bubbles || !col ? css('--empty') : col, ...(col || !o.empty ? {} : {}),
      tabindex: bubbles ? null : 0, role: bubbles ? null : 'button', 'aria-label': bubbles ? null : aria(c) });
    if (!bubbles) {
      hover(p, () => o.tip(c)); const open = () => o.onClick ? o.onClick(c) : selection.set(c.i);
      p.addEventListener('click', open); p.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
    }
    g.append(p);
  }
  if (bubbles) {
    const kr = 0.07 * W / Math.sqrt(Math.max(...C.map(c => o.size(c))));
    [...C].sort((a, b) => o.size(b) - o.size(a)).forEach(c => {
      const col = o.color(c); if (!col) return;
      const [cx, cy] = GEO.counties[c.fips].c, r = Math.max(3.5, kr * Math.sqrt(o.size(c)));
      const b = s('circle', { class: 'bubble-dot' + (sel === c.i ? ' sel' : ''), cx: cx * k, cy: cy * k, r, fill: col, 'fill-opacity': .92, tabindex: 0, role: 'button', 'aria-label': aria(c) });
      hover(b, () => o.tip(c)); const open = () => o.onClick ? o.onClick(c) : selection.set(c.i);
      b.addEventListener('click', open); b.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      svg.append(b);
    });
  } else if (sel != null) svg.append(s('g', { transform: `scale(${k})` }, s('path', { class: 'county sel', d: GEO.counties[C[sel].fips].d, fill: 'none', 'fill-rule': 'evenodd', 'pointer-events': 'none' })));
  const lx = 12, rowH = 21; let yb = H - 10;
  if (bubbles && o.sizeKey) {
    const kr = 0.07 * W / Math.sqrt(Math.max(...C.map(c => o.size(c)))), rBig = kr * Math.sqrt(o.sizeKey[0]), bx = lx + rBig + 2;
    o.sizeKey.forEach(v => { const r = kr * Math.sqrt(v), cy = yb - r; svg.append(s('circle', { cx: bx, cy, r, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1.2 }), s('text', { class: 't-axis', x: bx + rBig + 10, y: yb - 2 * r + 11 }, fComp(v))); });
    svg.append(s('text', { class: 't-note', x: lx, y: yb - 2 * rBig - 10 }, o.sizeLabel || 'Circle area'));
    yb -= 2 * rBig + 34;
  }
  (o.notes || []).slice().reverse().forEach(t => { svg.append(s('text', { class: 't-axis', x: lx, y: yb }, t)); yb -= 15; });
  if (o.notes && o.notes.length) yb -= 4;
  const legend = o.legend || [], ly = yb - legend.length * rowH;
  if (o.legendTitle) svg.append(s('text', { class: 't-note', x: lx, y: ly - 8 }, o.legendTitle));
  legend.forEach((cl, i) => svg.append(s('rect', { x: lx, y: ly + i * rowH, width: 16, height: 14, rx: 4, fill: cl.color, ...(cl.outline ? { stroke: 'var(--axis)' } : {}) }), s('text', { class: 't-axis', x: lx + 24, y: ly + i * rowH + 11 }, cl.label)));
  return svg;
}

/* a labeled grid of colored cells */
function kitHeat(host, w, rows, cols, val, o = {}) {
  const rh = o.rowH || 20, m = { l: o.labelW ?? Math.min(150, w * .3), r: 8, t: 46, b: o.legend === false ? 8 : 40 }, iw = w - m.l - m.r, cw = iw / cols.length, H = m.t + rows.length * rh + m.b;
  let max = o.max; if (max == null) { max = 0; rows.forEach((_, i) => cols.forEach((__, j) => { const v = val(i, j); if (v != null && v > max) max = v; })); }
  const svg = svgBox(w, H); host.append(svg);
  cols.forEach((c, j) => { const cx = m.l + cw * (j + .5); svg.append(s('text', { class: 't-axis', x: cx, y: m.t - 24, 'text-anchor': 'middle', style: { fontWeight: c.strong ? 800 : 600, fontSize: cw < 24 ? '10px' : '12px' } }, c.top || ''), s('text', { class: 't-axis', x: cx, y: m.t - 9, 'text-anchor': 'middle' }, cw > 26 || j % 2 === 0 ? (c.label || '') : '')); });
  rows.forEach((r, i) => {
    const y = m.t + i * rh;
    svg.append(s('text', { class: 't-lab', x: m.l - 8, y: y + rh / 2 + 4, 'text-anchor': 'end', style: { fontSize: rh < 16 ? '11px' : '13px', fontWeight: r.hi ? 900 : 700 } }, fitText(r.label, rh < 16 ? 11 : 13, 700, m.l - 14)));
    cols.forEach((c, j) => {
      const v = val(i, j), cell = s('rect', { class: 'cell' + (o.click ? ' clickable' : ''), x: m.l + j * cw + 1, y: y + 1, width: Math.max(cw - 2, 1), height: rh - 2, rx: 3, fill: v == null || v <= 0 ? css('--empty') : (o.color ? o.color(v, max) : seqColor(v / max)) });
      hover(cell, () => o.tip(i, j, v)); if (o.click) cell.addEventListener('click', () => o.click(i, j));
      svg.append(cell);
    });
  });
  if (o.legend !== false) gradientLegend(svg, m.l, H - 30, Math.min(260, iw), 9, o.legendLo || '0', o.legendHi ? o.legendHi(max) : fComp(max));
  return svg;
}

/* histogram of numbers; o: {bin, refs: [{v, label, anchor}], fmtX, mark: {v, label}, names: item => string, height} */
function kitHist(host, w, items, o = {}) {
  const vals = items.map(i => i.v), bw0 = o.bin || 2.5;
  const lo = o.lo ?? Math.floor(Math.min(...vals) / bw0) * bw0, hi = o.hi ?? Math.ceil((Math.max(...vals) + 1e-9) / bw0) * bw0;
  const nb = Math.max(1, Math.round((hi - lo) / bw0)), bins = Array.from({ length: nb }, (_, i) => ({ a: lo + i * bw0, b: lo + (i + 1) * bw0, items: [] }));
  items.forEach(it => { const j = Math.min(nb - 1, Math.max(0, Math.floor((it.v - lo) / bw0))); bins[j].items.push(it); });
  const H = o.height || clamp(Math.round(w * .42), 240, 320), m = { l: 50, r: 12, t: 30, b: 34 }, iw = w - m.l - m.r, x = linear(lo, hi, m.l, m.l + iw);
  const refs = (o.refs || []).map(r => ({ ...r, xx: crisp(x(r.v)), lw: r.label.length * 6.4 + 10 })).sort((a, b) => a.xx - b.xx), rowEnd = [];
  refs.forEach((r, i) => {                        // labels point away from each other; flip at an edge; stack what still collides
    let a = refs.length > 1 ? (i === 0 ? 'end' : 'start') : (r.anchor === 'end' ? 'end' : 'start');
    if (a === 'start' && r.xx + 6 + r.lw > w - m.r) a = 'end'; else if (a === 'end' && r.xx - 6 - r.lw < m.l) a = 'start';
    const x0 = a === 'end' ? r.xx - 6 - r.lw : r.xx + 6; r.a = a; r.row = 0;
    while (rowEnd[r.row] > x0 - 4) r.row++;
    rowEnd[r.row] = x0 + r.lw;
  });
  m.t += 14 * Math.max(0, ...refs.map(r => r.row));
  const ih = H - m.t - m.b, ty = niceTicks(Math.max(...bins.map(b => b.items.length), 1) * 1.08, 4), y = linear(0, ty.max, m.t + ih, m.t);
  const svg = svgBox(w, H); host.append(svg); axisY(svg, y, ty.ticks, m.l, w - m.r, fComp);
  const fx = o.fmtX || (v => v + '%'), step = Math.max(bw0, Math.ceil((hi - lo) / Math.max(2, Math.floor(iw / 62)) / bw0) * bw0);
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) svg.append(s('text', { class: 't-axis', x: x(v), y: m.t + ih + 18, 'text-anchor': 'middle' }, fx(v)));
  const bwpx = iw / nb;
  bins.forEach(b => {
    const n = b.items.length, ht = y(0) - y(n), bx = m.l + (b.a - lo) / bw0 * bwpx, mine = o.mark && o.mark.v >= b.a && o.mark.v < b.b;
    if (n) svg.append(s('path', { class: 'mark', d: rrect(bx + 1, y(n), bwpx - 2, ht, { tl: Math.min(4, ht), tr: Math.min(4, ht) }), fill: o.color || 'var(--early)', ...(mine ? { stroke: 'var(--ink)', 'stroke-width': 2 } : {}) }));
    const hit = s('rect', { class: 'hit', x: bx, y: m.t, width: bwpx, height: ih });
    hover(hit, () => tipContent(`${fx(b.a)} to ${fx(b.b)}`, [{ label: o.unit || 'Count', value: fInt(n) }], n && o.names ? b.items.slice(0, 7).map(o.names).join(', ') + (n > 7 ? `, +${n - 7} more` : '') : null));
    svg.append(hit);
  });
  refs.forEach(r => svg.append(s('line', { class: 'refl', x1: r.xx, x2: r.xx, y1: m.t - 4 - r.row * 14, y2: m.t + ih }), s('text', { class: 't-note', x: r.a === 'end' ? r.xx - 6 : r.xx + 6, y: m.t - 10 - r.row * 14, 'text-anchor': r.a }, r.label)));
  if (o.mark) { const xx = crisp(x(o.mark.v)); svg.append(s('path', { d: `M${xx - 6},${m.t + ih + 4} L${xx + 6},${m.t + ih + 4} L${xx},${m.t + ih - 6} Z`, fill: 'var(--ink)' }), s('text', { class: 't-note', x: xx, y: m.t + ih - 12, 'text-anchor': 'middle' }, o.mark.label)); }
  if (o.xLabel) svg.append(s('text', { class: 't-axis', x: m.l + iw, y: H - 2, 'text-anchor': 'end' }, o.xLabel));
  return svg;
}

/* box plots, one row per group; rows: [{label, sub, color, st: boxStats(), dot?, hi?}]. Values are percentages. */
function kitBoxes(host, w, rows, o = {}) {
  const rh = o.rowH || 62, bt = 22, m = { l: w < 480 ? 118 : 156, r: 14, t: 8, b: 38 }, H = m.t + rows.length * rh + m.b, iw = w - m.l - m.r;
  const hi = Math.min(100, Math.ceil(Math.max(...rows.map(r => Math.max(...r.st.out, r.st.whi))) / 10) * 10) || 100, x = linear(0, hi, m.l, m.l + iw);
  const svg = svgBox(w, H); host.append(svg);
  const stepT = iw / (hi / 10) < 40 ? 20 : 10;
  axisX(svg, x, Array.from({ length: Math.floor(hi / stepT) + 1 }, (_, i) => i * stepT), m.t, H - m.b, v => v + '%', H - m.b + 17);
  rows.forEach((r, i) => {
    const cy = m.t + i * rh + rh / 2, st = r.st, lw = m.l - (r.dot ? 36 : 14);
    svg.append(s('text', { class: 't-lab', x: m.l - 12, y: cy - 2, 'text-anchor': 'end', style: { fontWeight: r.hi ? 900 : 700 } }, fitText(r.label, 13, r.hi ? 900 : 700, lw)), s('text', { class: 't-axis', x: m.l - 12, y: cy + 14, 'text-anchor': 'end' }, fitText(r.sub || '', 12, 600, lw)));
    if (r.dot) svg.append(s('circle', { cx: 9, cy, r: 5.5, fill: r.dot, stroke: 'var(--surface)', 'stroke-width': 1.5 }));
    st.out.forEach(v => svg.append(s('circle', { cx: x(v), cy, r: 2.4, fill: r.color, opacity: .45 })));
    svg.append(s('line', { x1: x(st.wlo), x2: x(st.q1), y1: cy, y2: cy, stroke: 'var(--ink-3)', 'stroke-width': 2 }), s('line', { x1: x(st.q3), x2: x(st.whi), y1: cy, y2: cy, stroke: 'var(--ink-3)', 'stroke-width': 2 }),
      s('line', { x1: x(st.wlo), x2: x(st.wlo), y1: cy - 7, y2: cy + 7, stroke: 'var(--ink-3)', 'stroke-width': 2 }), s('line', { x1: x(st.whi), x2: x(st.whi), y1: cy - 7, y2: cy + 7, stroke: 'var(--ink-3)', 'stroke-width': 2 }));
    svg.append(s('path', { class: 'mark', d: rrect(x(st.q1), cy - bt / 2, Math.max(x(st.q3) - x(st.q1), 2), bt, { tl: 4, tr: 4, bl: 4, br: 4 }), fill: r.color }), s('line', { x1: x(st.med), x2: x(st.med), y1: cy - bt / 2 + 3, y2: cy + bt / 2 - 3, stroke: 'var(--surface)', 'stroke-width': 3, 'stroke-linecap': 'round' }),
      s('text', { class: 't-val', x: x(st.med), y: cy - bt / 2 - 7, 'text-anchor': 'middle' }, fPct(st.med)));
    const hit = s('rect', { class: 'hit', x: 0, y: cy - rh / 2, width: w, height: rh });
    hover(hit, () => tipContent(r.label, [{ label: 'Precincts', value: fInt(st.n) }, { label: 'Median', value: fPct(st.med) }, { label: 'Middle half', value: `${fPct(st.q1)} to ${fPct(st.q3)}` }, { label: 'Typical range', value: `${fPct(st.wlo)} to ${fPct(st.whi)}` }, { label: 'Outliers', value: fInt(st.out.length) }]));
    svg.append(hit);
  });
  return svg;
}

/* dot plot: one row per category, one dot per series; rows: [{label, sub, dots: [{v, color, name}]}] */
function kitDots(host, w, rows, o = {}) {
  const rh = o.rowH || 46, narrow = w < 480, labW = o.labelW ?? (narrow ? Math.min(112, w * .32) : Math.min(180, w * .3)), fmt = o.fmt || fComp;
  const m = { l: labW, r: 26, t: 6, b: 28 }, H = m.t + rows.length * rh + m.b, iw = w - m.l - m.r;
  const all = rows.flatMap(r => r.dots.map(d => d.v)).filter(v => v != null), lo0 = o.min ?? 0, hiV = Math.max(...all, 1e-9);
  const tk = niceTicks(Math.max(o.max ?? hiV, hiV) * 1.04, 5, lo0), x = linear(tk.ticks[0], tk.max, m.l, m.l + iw), svg = svgBox(w, H); host.append(svg);
  axisX(svg, x, tk.ticks, m.t, H - m.b, o.axisFmt || fmt, H - m.b + 17);
  rows.forEach((r, i) => {
    const cy = m.t + i * rh + rh / 2, ds = r.dots.filter(d => d.v != null);
    svg.append(s('text', { class: 't-lab', x: m.l - 10, y: cy + (r.sub ? -2 : 4.5), 'text-anchor': 'end' }, fitText(r.label, 13, 700, m.l - 16)));
    if (r.sub) svg.append(s('text', { class: 't-axis', x: m.l - 10, y: cy + 12, 'text-anchor': 'end' }, fitText(r.sub, 12, 600, m.l - 16)));
    if (ds.length > 1) { const vs = ds.map(d => d.v); svg.append(s('line', { x1: x(Math.min(...vs)), x2: x(Math.max(...vs)), y1: cy, y2: cy, stroke: 'var(--ink-3)', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: .5 })); }
    [...ds].reverse().forEach(d => svg.append(s('circle', { cx: x(d.v), cy, r: d.r || 6.5, fill: d.color, stroke: 'var(--surface)', 'stroke-width': 2 })));
    const hit = s('rect', { class: 'hit', x: 0, y: cy - rh / 2, width: w, height: rh });
    hover(hit, () => tipContent(r.label, [...ds].sort((a, b) => b.v - a.v).map(d => ({ color: d.color, label: d.name, value: fmt(d.v) }))));
    svg.append(hit);
  });
  return svg;
}

/* a sortable, searchable-by-caller table. cols: [{k, t, get, fmt, n, node, nosort}]. state: {key, dir}. */
function kitTable(cols, rows, state, rerender, o = {}) {
  const c0 = cols.find(c => c.k === state.key) || cols[0];
  const sorted2 = [...rows].sort((a, b) => { const va = c0.get(a), vb = c0.get(b); return (typeof va === 'string' ? va.localeCompare(vb) : (va ?? -Infinity) - (vb ?? -Infinity)) * state.dir; });
  const head = h('tr', null, cols.map(c => h('th', { class: c.n ? 'n' : '', scope: 'col', 'aria-sort': state.key === c.k ? (state.dir > 0 ? 'ascending' : 'descending') : null },
    c.nosort ? h('span', { style: { padding: '10px 12px', display: 'block', fontWeight: 800, color: 'var(--ink-2)' } }, c.t)
      : h('button', { type: 'button', onclick: () => { state.dir = state.key === c.k ? -state.dir : (typeof c.get(rows[0] || {}) === 'string' ? 1 : -1); state.key = c.k; rerender(); } }, c.t))));
  const body = sorted2.slice(0, o.limit || 5000).map(r => h('tr', { class: o.rowClass ? o.rowClass(r) : '', tabindex: o.onRow ? 0 : null, onclick: o.onRow ? () => o.onRow(r) : null, onkeydown: o.onRow ? e => { if (e.key === 'Enter') o.onRow(r); } : null },
    cols.map(c => h('td', { class: (c.n ? 'n ' : '') + (c.cls || '') }, c.node ? c.node(r) : (c.fmt ? c.fmt(c.get(r), r) : String(c.get(r) ?? ''))))));
  return h('div', { class: 'dtable-wrap', style: o.maxH ? { maxHeight: o.maxH } : null, tabindex: 0, role: 'region', 'aria-label': o.label || 'Table' },
    h('table', { class: 'dtable', style: o.minW ? { minWidth: o.minW } : null }, h('thead', null, head), h('tbody', null, body.length ? body : h('tr', null, h('td', { colspan: cols.length }, o.empty || 'Nothing matches.')))));
}

/* tiny helpers shared by the views */
const emptyCard = (host, text) => host.append(emptyState(text));
const selectOf = (label, opts, value, onChange, cls = '') => h('label', { class: cls }, label, h('select', { class: 'field', onchange: e => onChange(e.target.value) },
  opts.map(o => Array.isArray(o) ? h('option', { value: o[0], ...(String(o[0]) === String(value) ? { selected: true } : {}) }, o[1]) : o)));
const chipRow = (opts, value, onChange, label) => h('div', { class: 'chips', role: 'group', 'aria-label': label },
  opts.map(([v, text]) => h('button', { type: 'button', class: 'chipbtn', 'aria-pressed': String(v === value), onclick: e => { [...e.currentTarget.parentNode.children].forEach(b => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); onChange(v); } }, text)));
