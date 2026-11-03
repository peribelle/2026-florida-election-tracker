/* ---------- shared SVG helpers for the charts ---------- */
const svgBox = (w, ht) => s('svg', { viewBox: `0 0 ${w} ${ht}`, width: w, height: ht, 'aria-hidden': 'true' });

/* rounded rect where each corner can differ: bars are square at the baseline, 4px at the data end */
function rrect(x, y, w, ht, r = {}) {
  const tl = r.tl || 0, tr = r.tr || 0, br = r.br || 0, bl = r.bl || 0;
  return `M${x + tl},${y}H${x + w - tr}${tr ? `Q${x + w},${y} ${x + w},${y + tr}` : ''}V${y + ht - br}${br ? `Q${x + w},${y + ht} ${x + w - br},${y + ht}` : ''}H${x + bl}${bl ? `Q${x},${y + ht} ${x},${y + ht - bl}` : ''}V${y + tl}${tl ? `Q${x},${y} ${x + tl},${y}` : ''}Z`;
}
const crisp = v => Math.round(v) + .5;

/* horizontal gridlines + left labels for a vertical value axis */
function axisY(g, sc, ticks, x0, x1, fmt) {
  ticks.forEach(t => {
    const y = crisp(sc(t));
    g.append(s('line', { class: t === 0 ? 'axisl' : 'gridl', x1: x0, x2: x1, y1: y, y2: y }));
    g.append(s('text', { class: 't-axis', x: x0 - 8, y: y + 4, 'text-anchor': 'end' }, fmt(t)));
  });
}
/* vertical gridlines + bottom labels for a horizontal value axis */
function axisX(g, sc, ticks, y0, y1, fmt, labelY) {
  ticks.forEach(t => {
    const x = crisp(sc(t));
    g.append(s('line', { class: 'gridl', x1: x, x2: x, y1: y0, y2: y1 }));
    g.append(s('text', { class: 't-axis', x, y: labelY ?? y1 + 17, 'text-anchor': 'middle' }, fmt(t)));
  });
}
/* keep labels apart: nudge a sorted list of y positions so neighbours are at least gap apart */
function spread(ys, gap) {
  const idx = ys.map((y, i) => i).sort((a, b) => ys[a] - ys[b]), out = [...ys];
  for (let k = 1; k < idx.length; k++) if (out[idx[k]] - out[idx[k - 1]] < gap) out[idx[k]] = out[idx[k - 1]] + gap;
  return out;
}
/* sequential color for a 0..1 value, along the current theme's taro ramp */
let rampCache = { key: '', fn: null };
function seqColor(t) {
  const stops = seqStops(), key = stops.join();
  if (rampCache.key !== key) rampCache = { key, fn: ramp(stops) };
  return rampCache.fn(t);
}
/* five-class bins by quantile: returns the upper bounds so every shade holds about the same number of items */
function quantileBreaks(values, k = 5) {
  const srt = sorted(values);
  return Array.from({ length: k - 1 }, (_, i) => quantile(srt, (i + 1) / k));
}
const classOf = (v, breaks) => { let i = 0; while (i < breaks.length && v > breaks[i]) i++; return i; };
function gradientLegend(svg, x, y, w, ht, lo, hi) {                  // a continuous swatch with end labels
  const id = 'g' + Math.random().toString(36).slice(2, 8), stops = seqStops();
  const lg = s('linearGradient', { id, x1: 0, x2: 1 }, stops.map((c, i) => s('stop', { offset: i / (stops.length - 1), 'stop-color': c })));
  svg.append(s('defs', null, lg), s('rect', { x, y, width: w, height: ht, rx: ht / 2, fill: `url(#${id})` }),
    s('text', { class: 't-axis', x, y: y + ht + 14 }, lo), s('text', { class: 't-axis', x: x + w, y: y + ht + 14, 'text-anchor': 'end' }, hi));
}
