/* ---------- chapter: spread and relationships ---------- */
const iqr = arr => { const s2 = sorted(arr); return quantile(s2, .75) - quantile(s2, .25); };

/* ---- histogram: counties or precincts ---- */
function histData(unit, ci = null) {
  return unit === 'county' ? C.map(c => ({ v: c.rate, name: c.name, c })) : PR.filter(p => ci == null || p.c === ci).map(p => ({ v: p.rate, name: `${C[p.c].name} ${p.k}` }));
}
function drawHist(host, w, api, unit) {
  const ci = scopeCi(), items = histData(unit, ci), vals = items.map(i => i.v);
  if (items.length < 2) { emptyCard(host, `${scopeName()} has too few precincts with 50 or more registered voters to draw a histogram.`); api.label('Not enough precincts.'); return; }
  const med = median(vals), me = ci != null && unit === 'county' ? C[ci] : null;
  const refs = unit === 'county' ? [{ v: med, label: `Typical county (median) ${fPct(med)}` }, { v: ST.rate, label: `Florida overall ${fPct(ST.rate)}` }]
    : [{ v: med, label: `Median precinct ${fPct(med)}` }, ...(ci != null ? [{ v: ST.rate, label: `Florida ${fPct(ST.rate)}` }] : [])];
  kitHist(host, w, items, { bin: 2.5, unit: unit === 'county' ? 'Counties' : 'Precincts', names: unit === 'county' ? i => i.name : null, mark: me ? { v: me.rate, label: me.name } : null, refs, xLabel: 'Turnout (ballots ÷ registered voters)' });
  api.label(`Histogram of ${unit === 'county' ? 'county' : 'precinct'} turnout in 2.5-point bins${ci != null && unit === 'precinct' ? ` for ${scopeLabel()}` : ''}.`);
}
function histCard() {
  let unit = 'county', api;
  const seg = live(h('div'), () => segmented('Unit', [['county', `${N} counties`], ['precinct', scopeC() ? `${scopeName()}’s ${fInt(PR.filter(p => p.c === scopeCi()).length)} precincts` : `${fInt(PR.length)} precincts`]], unit, v => { unit = v; api.redraw(); }));
  api = card({
    id: 'c-hist', kicker: 'Histogram', cat: 'mochi', stack: true, controls: [seg],
    title: () => {
      const me = scopeC();
      if (me && unit === 'county') return `${me.name}’s turnout (${fPct(me.rate)}) is higher than ${Math.round(100 * C.filter(c => c.rate < me.rate).length / (N - 1))}% of Florida counties`;
      const v = histData(unit, scopeCi()).map(i => i.v); if (v.length < 2) return 'Not enough precincts to compare';
      const s2 = sorted(v); return `Half of ${unit === 'county' ? 'all counties' : me ? `${me.name}’s precincts` : 'all precincts'} sit between ${fPct(quantile(s2, .25))} and ${fPct(quantile(s2, .75))}`;
    },
    sub: () => unit === 'county' ? `How many counties fall into each 2.5-point band of turnout.${scopeC() ? ` The triangle marks ${scopeName()}.` : ''}` : `How many precincts fall into each 2.5-point band of turnout (precincts with at least 50 registered voters).`,
    draw: (host, w, a) => drawHist(host, w, a, unit),
    notes: {
      what: 'A histogram sorts values into ranges called bins and counts how many land in each. The bars show the shape of the data: where it bunches up and how far it stretches.',
      how: 'Each bar is a band of turnout. Its height is how many counties (or precincts) fall in that band. Tall bars mean common values. The vertical lines mark the median and the statewide rate.',
      shows: () => unit === 'county'
        ? `The typical county (the median) is at **${fPct(median(COUNTY_RATES))}**, but the statewide rate is **${fPct(ST.rate)}**. The average of the 67 county rates is **${fPct(mean(COUNTY_RATES))}**.`
        : (() => { const v = histData(unit, scopeCi()).map(i => i.v); return v.length < 2 ? 'Too few precincts here.' : `The median precinct${scopeC() ? ` in ${scopeName()}` : ''} is at **${fPct(median(v))}**, ${scopeC() ? `against **${fPct(ST.rate)}** statewide` : 'close to the statewide rate'}. The middle half of precincts spans **${iqr(v).toFixed(1)}** points.`; })(),
      watch: 'Bin width changes the picture. Too wide hides the shape, too narrow makes noise. Treat any single histogram as one view.',
      nerd: { title: 'median, average, or weighted?', text: () => `The median is the middle county (${fPct(median(COUNTY_RATES))}). The plain average of county rates is ${fPct(mean(COUNTY_RATES))}. The statewide rate (${fPct(ST.rate)}) counts every voter once, so big counties pull it up. Three honest numbers, three different questions.` },
    },
    table: () => { const items = histData(unit, scopeCi()).sort((a, b) => b.v - a.v).slice(0, 500); return { head: ['Name', 'Turnout'], align: ['l', 'n'], rows: items.map(i => [i.name, fPct(i.v, 2)]) }; },
  });
  return api;
}

/* ---- box plot of precinct turnout, by county size ---- */
function boxStats(vals) {
  const s2 = sorted(vals), q1 = quantile(s2, .25), med = quantile(s2, .5), q3 = quantile(s2, .75), f = 1.5 * (q3 - q1), arr = Array.from(s2);
  const inside = arr.filter(v => v >= q1 - f && v <= q3 + f);
  return { n: arr.length, q1, med, q3, wlo: inside[0], whi: inside[inside.length - 1], out: arr.filter(v => v < q1 - f || v > q3 + f) };
}
const tierStats = () => TIERS.map((t, i) => ({ ...t, i, nCounties: C.filter(c => c.tier === i).length, ...boxStats(PR.filter(p => C[p.c].tier === i).map(p => p.rate)) }));
function boxRows() {
  const rows = tierStats().map(r => ({ ...r, title: `${r.label} counties`, subtitle: `${r.range} voters` })), ci = scopeCi();
  if (ci != null) {
    const v = PR.filter(p => p.c === ci).map(p => p.rate);
    if (v.length >= 5) rows.unshift({ ...boxStats(v), i: C[ci].tier, title: C[ci].name, subtitle: `${fInt(v.length)} precincts`, mine: true, nCounties: 1, range: `${fComp(C[ci].reg)} voters` });
  }
  return rows;
}
function drawBox(host, w, api) {
  const rows = boxRows(), rh = 66, bt = 24, m = { l: w < 480 ? 124 : 146, r: 14, t: 8, b: 40 }, H = m.t + rows.length * rh + m.b, iw = w - m.l - m.r;
  const hi = Math.min(100, Math.ceil(Math.max(...rows.map(r => Math.max(...r.out, r.whi))) / 10) * 10), x = linear(0, hi, m.l, m.l + iw), cols = tierColors();
  const svg = svgBox(w, H); host.append(svg);
  const stepT = iw / (hi / 10) < 40 ? 20 : 10;
  axisX(svg, x, Array.from({ length: Math.floor(hi / stepT) + 1 }, (_, i) => i * stepT), m.t, H - m.b, v => v + '%', H - m.b + 17);
  rows.forEach((r, i) => {
    const cy = m.t + i * rh + rh / 2, mineTier = scopeC() && !r.mine && r.i === scopeC().tier;
    if (mineTier) svg.append(s('rect', { x: 2, y: cy - rh / 2 + 2, width: w - 4, height: rh - 4, rx: 10, fill: 'var(--wash)' }));
    svg.append(s('text', { class: 't-lab', x: m.l - 12, y: cy - 2, 'text-anchor': 'end', style: { fontWeight: r.mine ? 900 : 700 } }, fitText(r.title, 13, r.mine ? 900 : 700, m.l - 18)), s('text', { class: 't-axis', x: m.l - 12, y: cy + 14, 'text-anchor': 'end' }, r.subtitle));
    r.out.forEach(v => svg.append(s('circle', { cx: x(v), cy, r: 2.4, fill: cols[r.i], opacity: .45 })));
    svg.append(s('line', { x1: x(r.wlo), x2: x(r.q1), y1: cy, y2: cy, stroke: 'var(--ink-3)', 'stroke-width': 2 }), s('line', { x1: x(r.q3), x2: x(r.whi), y1: cy, y2: cy, stroke: 'var(--ink-3)', 'stroke-width': 2 }),
      s('line', { x1: x(r.wlo), x2: x(r.wlo), y1: cy - 7, y2: cy + 7, stroke: 'var(--ink-3)', 'stroke-width': 2 }), s('line', { x1: x(r.whi), x2: x(r.whi), y1: cy - 7, y2: cy + 7, stroke: 'var(--ink-3)', 'stroke-width': 2 }));
    svg.append(s('path', { class: 'mark', d: rrect(x(r.q1), cy - bt / 2, x(r.q3) - x(r.q1), bt, { tl: 4, tr: 4, bl: 4, br: 4 }), fill: cols[r.i], ...(r.mine ? { stroke: 'var(--ink)', 'stroke-width': 2 } : {}) }), s('line', { x1: x(r.med), x2: x(r.med), y1: cy - bt / 2 + 3, y2: cy + bt / 2 - 3, stroke: 'var(--surface)', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    svg.append(s('text', { class: 't-val', x: x(r.med), y: cy - bt / 2 - 7, 'text-anchor': 'middle' }, fPct(r.med)));
    const hit = s('rect', { class: 'hit', x: 0, y: cy - rh / 2, width: w, height: rh });
    hover(hit, () => tipContent(r.mine ? `${r.title} (${r.range})` : `${r.label} counties (${r.range} voters)`, [{ label: 'Counties', value: fInt(r.nCounties) }, { label: 'Precincts', value: fInt(r.n) }, { label: 'Median', value: fPct(r.med) }, { label: 'Middle half', value: `${fPct(r.q1)} to ${fPct(r.q3)}` }, { label: 'Typical range', value: `${fPct(r.wlo)} to ${fPct(r.whi)}` }, { label: 'Outliers', value: fInt(r.out.length) }]));
    svg.append(hit);
  });
  api.label('Box plots of precinct turnout for four sizes of county.');
}
function boxCard() {
  return card({
    id: 'c-box', kicker: 'Box plot', cat: 'pearl', stack: true,
    title: () => { const t = tierStats(), best = [...t].sort((a, b) => b.med - a.med)[0], worst = [...t].sort((a, b) => a.med - b.med)[0]; return `Median precinct turnout is highest in ${best.label.toLowerCase()} counties (${fPct(best.med)}) and lowest in ${worst.label.toLowerCase()} ones (${fPct(worst.med)})`; },
    sub: () => `Precinct turnout, grouped by how many registered voters the county has. ${fInt(PR.length)} precincts with at least 50 registered voters.${scopeC() && boxRows()[0].mine ? ` ${scopeName()}’s own precincts are the outlined top row; its size group is shaded.` : ''}`,
    draw: drawBox,
    notes: {
      what: 'A box plot squeezes a whole distribution into five numbers: the middle half of the data is the box, the line inside is the median, the whiskers reach the typical extremes, and dots are outliers.',
      how: 'The box runs from the 25th to the 75th percentile. The white notch is the median. Whiskers extend to the furthest point within 1.5 box-lengths. Dots beyond that are outliers.',
      shows: () => { const t = tierStats(); return t.map(r => `**${r.label}**: median ${fPct(r.med)}, middle half ${fPct(r.q1, 0)} to ${fPct(r.q3, 0)}`).join('. ') + '.'; },
      watch: 'Outliers are not errors. In this data they are often tiny precincts, where a handful of voters can swing the percentage. The next chart shows why.',
      nerd: { title: 'what is a percentile?', text: 'The 25th percentile (Q1) is the value that a quarter of precincts fall below; the 75th (Q3) is the value three quarters fall below. The span between them, the interquartile range, is a spread measure that ignores extreme values.' },
    },
    table: () => ({ head: ['County size', 'Counties', 'Precincts', 'Median', 'Q1', 'Q3', 'Outliers'], align: ['l', 'n', 'n', 'n', 'n', 'n', 'n'], rows: tierStats().map(r => [`${r.label} (${r.range})`, fInt(r.nCounties), fInt(r.n), fPct(r.med), fPct(r.q1), fPct(r.q3), fInt(r.out.length)]) }),
  });
}

/* ---- scatter: county size vs turnout ---- */
function drawScatter(host, w, api) {
  const lf = linfit(C.map(c => Math.log10(c.reg)), COUNTY_RATES), pred = v => lf.intercept + lf.slope * Math.log10(v);
  const pts = C.map(c => ({ x: c.reg, y: c.rate, label: c.name, hi: selection.i === c.i, always: selection.i === c.i, r: 5, click: () => selection.set(c.i),
    tip: () => tipContent(c.name, [{ label: 'Registered voters', value: fInt(c.reg) }, { label: 'Turnout', value: fPct(c.rate) }, { label: 'Trend line predicts', value: fPct(pred(c.reg)) }], pickHint) }));
  const fit = kitScatter(host, w, pts, { xLog: true, xFmt: fComp, yFmt: v => v + '%', xLabel: 'Registered voters in the county (log scale)', fit: true, labelN: 4 });
  api.label(`Scatter plot of county size against turnout. Correlation ${fit.r.toFixed(2)}.`);
}
function scatterCard() {
  let api;
  api = card({
    id: 'c-scatter', kicker: 'Scatter plot with trend line', cat: 'pearl',
    title: () => { const r = linfit(C.map(c => Math.log10(c.reg)), COUNTY_RATES).r; return `Bigger counties tend to have higher turnout (r = ${r.toFixed(2)})`; },
    sub: 'One dot per county. Registered voters across, turnout up.',
    draw: drawScatter,
    notes: {
      what: 'A scatter plot puts one dot per item on two axes to show whether two things move together. A trend line summarizes the pattern.',
      how: 'Right means more registered voters. The scale is logarithmic: each gridline is a few times the last, so small and giant counties both fit. Up means higher turnout.',
      shows: () => { const f = linfit(C.map(c => Math.log10(c.reg)), COUNTY_RATES); return `Correlation **r = ${f.r.toFixed(2)}**: a moderate-to-strong upward link. County size explains about **${Math.round(f.r2 * 100)}%** of the differences in turnout. Every tenfold jump in voters goes with about **${f.slope.toFixed(1)}** more points of turnout.`; },
      watch: 'Correlation is not causation. Size does not cause turnout. Age, income, campaigns, how easy voting is: many things differ between big and small counties. Dots far from the line are the interesting ones.',
      nerd: { title: 'r and R squared', text: 'r runs from -1 to +1: +1 is a perfect upward line, 0 is no straight-line link. R squared is r multiplied by itself, the share of the up-and-down in turnout that a straight line through size accounts for. The rest is everything else.' },
    },
    table: () => ({ head: ['County', 'Registered', 'Turnout'], align: ['l', 'n', 'n'], rows: [...C].sort((a, b) => b.reg - a.reg).map(c => [c.name, fInt(c.reg), fPct(c.rate, 2)]) }),
  });
  return api;
}

/* ---- funnel: precinct size vs turnout ---- */
function drawFunnel(host, w, api) {
  const H = clamp(Math.round(w * .62), 340, 480), m = { l: 52, r: 14, t: 14, b: 44 }, iw = w - m.l - m.r, ih = H - m.t - m.b;
  const xmax = Math.max(...PRF.map(p => p.r)) * 1.1, x = logScale(10, xmax, m.l, m.l + iw), y = linear(0, 100, m.t + ih, m.t), p0 = ST.rate / 100;
  const svg = svgBox(w, H); host.append(svg);
  [10, 30, 100, 300, 1e3, 3e3, 1e4].filter(v => v <= xmax).forEach(v => svg.append(s('line', { class: 'gridl', x1: crisp(x(v)), x2: crisp(x(v)), y1: m.t, y2: m.t + ih }), s('text', { class: 't-axis', x: x(v), y: m.t + ih + 17, 'text-anchor': 'middle' }, fComp(v))));
  [0, 20, 40, 60, 80, 100].forEach(v => svg.append(s('line', { class: v ? 'gridl' : 'axisl', x1: m.l, x2: w - m.r, y1: crisp(y(v)), y2: crisp(y(v)) }), s('text', { class: 't-axis', x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, v + '%')));
  svg.append(s('text', { class: 't-axis', x: m.l + iw / 2, y: H - 4, 'text-anchor': 'middle' }, 'Registered voters in the precinct (log scale)'));
  const g = s('g'); svg.append(g);
  PRF.forEach(p => g.append(s('circle', { cx: x(p.r), cy: y(p.rate), r: 1.7, fill: 'var(--early)', opacity: selection.i == null ? .3 : .16 })));
  if (selection.i != null) PRF.filter(p => p.c === selection.i).forEach(p => g.append(s('circle', { cx: x(p.r), cy: y(p.rate), r: 3.2, fill: 'var(--ink)', stroke: 'var(--surface)', 'stroke-width': 1, opacity: .92 })));
  const band = sign => { let d = ''; for (let i = 0; i <= 60; i++) { const n = 10 * (xmax / 10) ** (i / 60), v = clamp(100 * (p0 + sign * 1.96 * Math.sqrt(p0 * (1 - p0) / n)), 0, 100); d += `${i ? 'L' : 'M'}${x(n).toFixed(1)},${y(v).toFixed(1)}`; } return d; };
  [1, -1].forEach(sg => svg.append(s('path', { d: band(sg), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-dasharray': '6 5' })));
  svg.append(s('text', { class: 't-note', x: m.l + iw - 4, y: y(100 * (p0 + 1.96 * Math.sqrt(p0 * (1 - p0) / xmax))) - 8, 'text-anchor': 'end' }, 'Expected from chance alone'));
  const ring = s('circle', { r: 7, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' }); svg.append(ring);
  const cell = 24, grid = new Map();
  PRF.forEach(p => { p.px = x(p.r); p.py = y(p.rate); const k = `${Math.floor(p.px / cell)},${Math.floor(p.py / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(p); });
  const near = e => { const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (w / r.width), py = (e.clientY - r.top) * (H / r.height), gx = Math.floor(px / cell), gy = Math.floor(py / cell); let best = null, bd = 400; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of grid.get(`${gx + i},${gy + j}`) || []) { const d = (p.px - px) ** 2 + (p.py - py) ** 2; if (d < bd) { bd = d; best = p; } } return best; };
  const hit = s('rect', { class: 'hit', x: m.l, y: m.t, width: iw, height: ih });
  hover(hit, () => document.createDocumentFragment(), { move: e => { const p = near(e); if (!p) { ring.setAttribute('opacity', 0); tip.hide(); return; } ring.setAttribute('cx', p.px); ring.setAttribute('cy', p.py); ring.setAttribute('opacity', 1); tip.show(e, tipContent(`${C[p.c].name}, precinct ${p.k}`, [{ label: 'Registered voters', value: fInt(p.r) }, { label: 'Ballots', value: fInt(p.t) }, { label: 'Turnout', value: fPct(p.rate) }])); }, leave: () => ring.setAttribute('opacity', 0) });
  svg.append(hit);
  api.label('Scatter of about eight thousand precincts: precinct size against turnout, with the range expected from chance alone.');
}
function funnelCard() {
  return card({
    id: 'c-funnel', kicker: 'Funnel plot (dense scatter)', cat: 'pearl',
    title: 'Small precincts swing wildly while big ones settle down',
    sub: () => `${fInt(PRF.length)} precincts with at least 10 registered voters. Each dot is one precinct.${scopeC() ? ` ${scopeName()}’s ${fInt(PRF.filter(p => p.c === scopeCi()).length)} precincts are the dark dots.` : ''}`,
    legend: () => [{ type: 'dot', color: 'var(--early)', label: 'A precinct' }, ...(scopeC() ? [{ type: 'dot', color: 'var(--ink)', label: `A precinct in ${scopeName()}` }] : []), { type: 'line', color: 'var(--ink)', label: 'Spread you would expect from chance alone (95%)' }],
    foot: () => over100 ? `${over100} precinct${over100 === 1 ? '' : 's'} with more ballots than registered voters ${over100 === 1 ? 'is' : 'are'} off the chart (voters who registered or moved after the Oct 5 book closing).` : '',
    draw: drawFunnel,
    notes: {
      what: 'A funnel plot puts size on one axis and a rate on the other. Small groups wobble more by pure chance, so the cloud is wide on the left and narrows to the right like a funnel.',
      how: 'Left means few registered voters, right means many. The dashed curves show how far a precinct would usually stray if every voter flipped the same weighted coin. Dots outside them differ for real reasons.',
      shows: () => { const small = PRF.filter(p => p.r < 100).map(p => p.rate), big = PRF.filter(p => p.r >= 2000).map(p => p.rate); return `Among precincts under 100 voters the middle half spans **${iqr(small).toFixed(0)}** points of turnout. Among those over 2,000 it spans **${iqr(big).toFixed(0)}**. Big precincts still vary more than chance alone predicts, so real differences between neighborhoods exist too.`; },
      watch: 'A tiny precinct at 90% is not a miracle: it can be 9 voters out of 10. Rank small groups by rate and you mostly rank luck.',
      nerd: { title: 'where the dashed curves come from', text: () => `If each of n registered voters voted independently with the statewide probability p = ${(ST.rate / 100).toFixed(3)}, the share who voted would have a standard deviation of the square root of p times (1 - p) divided by n. The curves sit 1.96 of those above and below p. Real voters are not independent, which is part of why the cloud is wider.` },
    },
    table: () => ({ head: ['Size band', 'Precincts', 'Median turnout', 'Middle half spans (pts)'], align: ['l', 'n', 'n', 'n'], rows: [[10, 50], [50, 200], [200, 1000], [1000, 3000], [3000, 1e9]].map(([a, b]) => { const v = PRF.filter(p => p.r >= a && p.r < b).map(p => p.rate); return [b > 1e8 ? `${fInt(a)}+ voters` : `${fInt(a)} to ${fInt(b - 1)} voters`, fInt(v.length), fPct(median(v)), iqr(v).toFixed(1)]; }) }),
  });
}
