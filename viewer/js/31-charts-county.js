/* ---------- county-level charts: type bars, map, ranked bars, table ---------- */
const GEO = D.geo, TOP15 = [...C].sort((a, b) => b.total - a.total).slice(0, 15);
const pickHint = 'Click to tailor the page to this county';
const countyTipRows = c => [
  { label: 'Turnout', value: `${fPct(c.rate)}  (#${c.rank} of ${N})` }, { label: 'Ballots', value: fInt(c.total) },
  { label: 'Registered', value: fInt(c.reg) }, { label: 'By mail', value: fPct(c.mailShare) },
];

/* ---- ballot type by county: stacked bars, counts or shares ---- */
function typeBarRows(shareMode) {
  const rows = [...TOP15], ci = scopeCi();
  if (ci != null && !rows.some(c => c.i === ci)) rows.push(C[ci]);
  return rows.sort((a, b) => shareMode ? b.mailShare - a.mailShare : b.total - a.total);
}
function drawTypeBars(host, w, api, shareMode) {
  const rows = typeBarRows(shareMode);
  const rh = 28, bt = 18, m = { l: 108, r: 62, t: 6, b: shareMode ? 6 : 30 }, ih = rows.length * rh, H = m.t + ih + m.b, iw = w - m.l - m.r;
  const max = shareMode ? 100 : niceTicks(Math.max(...rows.map(c => c.total)), 4).max, x = linear(0, max, m.l, m.l + iw);
  const svg = svgBox(w, H); host.append(svg);
  if (!shareMode) axisX(svg, x, niceTicks(max, 4).ticks, m.t, m.t + ih, fComp, m.t + ih + 18);
  svg.append(s('line', { class: 'axisl', x1: crisp(m.l), x2: crisp(m.l), y1: m.t, y2: m.t + ih }));
  rows.forEach((c, i) => {
    const y = m.t + i * rh + (rh - bt) / 2, parts = [['Mail', c.mail, 'var(--mail)'], ['Early voting', c.early, 'var(--early)'], ['Election Day', c.ed, 'var(--ed)']].filter(p => p[1] > 0);
    const tot = c.mail + c.early + c.ed;
    const mine = selection.i === c.i;
    svg.append(s('text', { class: 't-lab', x: m.l - 10, y: y + bt / 2 + 4.5, 'text-anchor': 'end', style: { fontWeight: mine ? 900 : 700 } }, c.name));
    let cur = m.l;
    parts.forEach(([name, v, col], j) => {
      const wpx = (shareMode ? v / tot * 100 : v) / max * iw, last = j === parts.length - 1;
      const seg = s('path', { class: 'mark clickable', d: rrect(cur, y, Math.max(wpx - (last ? 0 : 2), 1), bt, last ? { tr: 4, br: 4 } : {}), fill: col, ...(mine ? { stroke: 'var(--ink)', 'stroke-width': 2 } : {}) });
      hover(seg, () => tipContent(c.name, [{ color: col, label: name, value: `${fInt(v)}  (${fPct(100 * v / tot)})` }, { label: 'All ballots', value: fInt(c.total) }], pickHint));
      seg.addEventListener('click', () => selection.set(c.i));
      svg.append(seg);
      const label = fPct(100 * v / tot, 0);
      if (shareMode && wpx > textW(label, 12, 800) + 16) svg.append(s('text', { class: 't-in' + labelInk(col), x: cur + (wpx - (last ? 0 : 2)) / 2, y: y + bt / 2 + 4, 'text-anchor': 'middle' }, label));
      cur += wpx;
    });
    svg.append(s('text', { class: 't-val', x: shareMode ? w - m.r + 10 : cur + 8, y: y + bt / 2 + 4.5 }, fComp(c.total)));
  });
  api.label(`Ballot type for the 15 counties with the most ballots${scopeC() ? ` and ${scopeName()}` : ''}, shown as ${shareMode ? 'shares of each county’s ballots' : 'counts'}.`);
}
function typeBarsCard() {
  let shareMode = false, api;
  const seg = segmented('Show', [[false, 'Number of ballots'], [true, 'Share of each county']], false, v => { shareMode = v; api.redraw(); });
  api = card({
    id: 'c-types', kicker: 'Stacked bar chart', cat: 'mochi', controls: [seg],
    title: () => {
      const me = scopeC();
      if (me) { const t = me.mail + me.early + me.ed; return t ? `${me.name}: ${fPct(100 * me.mail / t, 0)} of ballots came by mail, ${fPct(100 * me.early / t, 0)} early in person${HAS_ED ? `, ${fPct(100 * me.ed / t, 0)} on Election Day` : ''}` : `${me.name} has no ballots recorded yet`; }
      if (!shareMode) return `${TOP15[0].name}, ${TOP15[1].name} and ${TOP15[2].name} cast the most ballots`;
      const s2 = [...TOP15].sort((a, b) => a.mailShare - b.mailShare);
      return `Among the biggest counties, mail is ${fPct(s2[0].mailShare, 0)} of the vote in ${s2[0].name} and ${fPct(s2[14].mailShare, 0)} in ${s2[14].name}`;
    },
    sub: () => { const extra = scopeC() && !TOP15.some(c => c.i === scopeCi()) ? ` ${scopeName()} is added below them and outlined.` : scopeC() ? ` ${scopeName()} is outlined.` : ''; return (shareMode ? 'The 15 biggest counties, ordered by their share of mail ballots. Number at the right: total ballots.' : 'The 15 counties with the most ballots. Number at the end of each bar: total ballots.') + extra; },
    legend: typeLegend,
    draw: (host, w, a) => drawTypeBars(host, w, a, shareMode),
    notes: {
      what: 'A stacked bar splits one total into parts. Switch to shares and every bar becomes a 100% bar, so the question changes from "how many?" to "what is the mix?"',
      how: 'In counts, bar length is total ballots. In shares, every bar is the same length and only the colors move.',
      shows: () => { const mx = [...C].sort((a, b) => b.mailShare - a.mailShare)[0], mn = [...C].sort((a, b) => a.mailShare - b.mailShare)[0]; return `Statewide, **${fPct(100 * ST.mail / (ST.mail + ST.early + ST.ed), 0)}** of ballots came by mail. Across all 67 counties that ranges from **${fPct(mn.mailShare, 0)}** in ${mn.name} to **${fPct(mx.mailShare, 0)}** in ${mx.name}.`; },
      watch: 'Counts rank counties by population as much as by behavior. Use shares to compare habits.',
    },
    table: () => ({ head: ['County', 'Mail', 'Early voting', ...(HAS_ED ? ['Election Day'] : []), 'Total', 'Mail share'], align: ['l', 'n', 'n', ...(HAS_ED ? ['n'] : []), 'n', 'n'],
      rows: typeBarRows(false).map(c => [c.name, fInt(c.mail), fInt(c.early), ...(HAS_ED ? [fInt(c.ed)] : []), fInt(c.total), fPct(c.mailShare)]) }),
  });
  return api;
}

/* ---- the map ---- */
const MAP_METRICS = {
  rate: { label: 'Turnout %', val: c => c.rate, fmt: v => fPct(v), kind: 'seq' },
  total: { label: 'Ballots cast', val: c => c.total, fmt: fComp, kind: 'seq' },
  mail: { label: 'Share by mail', val: c => c.mailShare, fmt: v => fPct(v, 0), kind: 'seq' },
  gap: { label: 'Republican minus Democratic turnout rate', val: c => c.gap, fmt: v => fPts(v), kind: 'div' },
};
function mapScale(M) {
  const vals = C.map(M.val), min = Math.min(...vals), max = Math.max(...vals);
  if (M.kind === 'seq') {
    const br = quantileBreaks(vals), stops = seqStops(), edges = [min, ...br, max];
    return { color: v => stops[classOf(v, br)], classes: stops.map((c, i) => ({ color: c, label: `${M.fmt(edges[i])} to ${M.fmt(edges[i + 1])}` })) };
  }
  const mx = niceTicks(Math.max(Math.abs(min), Math.abs(max)), 3).max, br = [-2 * mx / 3, -mx / 3, 0, mx / 3, 2 * mx / 3];
  const cols = ['--div-d3', '--div-d2', '--div-d1', '--div-r1', '--div-r2', '--div-r3'].map(css);
  const lab = ['below ' + fPts(br[0], 0), `${fPts(br[0], 0)} to ${fPts(br[1], 0)}`, `${fPts(br[1], 0)} to 0`, `0 to ${fPts(br[3], 0)}`, `${fPts(br[3], 0)} to ${fPts(br[4], 0)}`, 'above ' + fPts(br[4], 0)];
  return { color: v => cols[classOf(v, br)], classes: cols.map((c, i) => ({ color: c, label: lab[i] })) };
}
function drawMap(host, w, api, st) {
  const M = MAP_METRICS[st.metric], sc = mapScale(M), vals = C.map(M.val);
  const W = Math.min(w, 720), k = W / GEO.viewBox[0], H = Math.round(GEO.viewBox[1] * k);
  const svg = svgBox(W, H); svg.style.maxWidth = W + 'px'; svg.style.margin = '0 auto'; host.append(svg);
  const rankOf = v => 1 + vals.filter(x => x > v).length;
  const bubbles = st.style === 'bubbles';
  const open = c => selection.set(c.i);
  const g = s('g', { transform: `scale(${k})` }); svg.append(g);
  for (const [fips, geo] of Object.entries(GEO.counties)) {
    const c = BY_FIPS[fips]; if (!c) continue;
    const p = s('path', { class: 'county', d: geo.d, 'fill-rule': 'evenodd', fill: bubbles ? css('--empty') : sc.color(M.val(c)), tabindex: bubbles ? null : 0, role: bubbles ? null : 'button', 'aria-label': bubbles ? null : `${c.name}: ${M.fmt(M.val(c))}` });
    if (!bubbles) {
      hover(p, () => tipContent(c.name, [{ label: M.label, value: `${M.fmt(M.val(c))}  (#${rankOf(M.val(c))})` }, ...countyTipRows(c).filter(r => !(st.metric === 'rate' && r.label === 'Turnout'))], pickHint));
      p.addEventListener('click', () => open(c)); p.addEventListener('keydown', e => { if (e.key === 'Enter') open(c); });
    }
    g.append(p);
  }
  if (bubbles) {
    const kr = 0.07 * W / Math.sqrt(Math.max(...C.map(c => c.reg)));
    [...C].sort((a, b) => b.reg - a.reg).forEach(c => {
      const [cx, cy] = GEO.counties[c.fips].c, r = Math.max(3.5, kr * Math.sqrt(c.reg));
      const b = s('circle', { class: 'bubble-dot' + (selection.i === c.i ? ' sel' : ''), cx: cx * k, cy: cy * k, r, fill: sc.color(M.val(c)), 'fill-opacity': .92, tabindex: 0, role: 'button', 'aria-label': `${c.name}: ${M.fmt(M.val(c))}` });
      hover(b, () => tipContent(c.name, [{ label: M.label, value: `${M.fmt(M.val(c))}  (#${rankOf(M.val(c))})` }, ...countyTipRows(c).filter(r2 => !(st.metric === 'rate' && r2.label === 'Turnout'))], pickHint));
      b.addEventListener('click', () => open(c)); b.addEventListener('keydown', e => { if (e.key === 'Enter') open(c); });
      svg.append(b);
    });
  } else if (selection.i != null) {
    svg.append(s('g', { transform: `scale(${k})` }, s('path', { class: 'county sel', d: GEO.counties[C[selection.i].fips].d, fill: 'none', 'fill-rule': 'evenodd', 'pointer-events': 'none' })));
  }
  // legend, tucked into the Gulf of Mexico: built upward from the bottom edge
  const lx = 12, rowH = 21; let yb = H - 10;
  if (bubbles) {
    const kr = 0.07 * W / Math.sqrt(Math.max(...C.map(c => c.reg))), rBig = kr * Math.sqrt(1e6), bx = lx + rBig + 2;
    [1e6, 1e5, 1e4].forEach(v => {
      const r = kr * Math.sqrt(v), cy = yb - r;
      svg.append(s('circle', { cx: bx, cy, r, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1.2 }), s('text', { class: 't-axis', x: bx + rBig + 10, y: yb - 2 * r + 11 }, fComp(v)));
    });
    svg.append(s('text', { class: 't-note', x: lx, y: yb - 2 * rBig - 10 }, 'Circle area = registered voters'));
    yb -= 2 * rBig + 34;
  }
  if (st.metric === 'gap') {
    svg.append(s('text', { class: 't-axis', x: lx, y: yb - 15 }, 'Red: Republicans vote at the higher rate'), s('text', { class: 't-axis', x: lx, y: yb }, 'Blue: Democrats do'));
    yb -= 30;
  }
  const ly = yb - sc.classes.length * rowH;
  svg.append(s('text', { class: 't-note', x: lx, y: ly - 8 }, M.label));
  sc.classes.forEach((cl, i) => svg.append(s('rect', { x: lx, y: ly + i * rowH, width: 16, height: 14, rx: 4, fill: cl.color }), s('text', { class: 't-axis', x: lx + 24, y: ly + i * rowH + 11 }, cl.label)));
  api.label(`Map of Florida counties colored by ${M.label.toLowerCase()}.`);
}
function mapCard() {
  const st = { metric: 'rate', style: 'shapes' }; let api;
  const pick = h('p', { class: 'foot-note', style: { marginTop: '6px', minHeight: '1.4em' } });
  const sync = () => { clear(pick); const c = selection.i == null ? null : C[selection.i]; if (c) pick.append(h('span', null, 'Selected: '), h('b', null, c.name), ` · ${fPct(c.rate)} turnout · #${c.rank} of ${N}`); else pick.append('Tip: click a county to tailor the whole page to it.'); };
  const controls = [
    selectField('Color by', Object.entries(MAP_METRICS).map(([k, m]) => [k, m.label]), st.metric, v => { st.metric = v; api.redraw(); }),
    segmented('Map style', [['shapes', 'Shapes'], ['bubbles', 'Bubbles']], st.style, v => { st.style = v; api.redraw(); }),
  ];
  api = card({
    id: 'c-map', kicker: 'Choropleth and bubble map', cat: 'mochi', controls,
    title: () => {
      const M = MAP_METRICS[st.metric], by = [...C].sort((a, b) => M.val(b) - M.val(a));
      if (scopeC()) { const me = scopeC(); return `${me.name} ranks #${1 + C.filter(x => M.val(x) > M.val(me)).length} of ${N} counties on ${M.label.toLowerCase()} (${M.fmt(M.val(me))})`; }
      if (st.metric === 'rate') return `${by[0].name} leads at ${fPct(by[0].rate)} and ${by[N - 1].name} trails at ${fPct(by[N - 1].rate)}`;
      if (st.metric === 'total') return `${by[0].name}, ${by[1].name} and ${by[2].name} hold ${fPct(100 * (by[0].total + by[1].total + by[2].total) / ST.total, 0)} of all ballots`;
      if (st.metric === 'mail') return `Mail is ${fPct(by[N - 1].mailShare, 0)} of the vote in ${by[N - 1].name} and ${fPct(by[0].mailShare, 0)} in ${by[0].name}`;
      return `Republicans lead on turnout rate in ${C.filter(c => c.gap > 0).length} counties; Democrats lead in ${C.filter(c => c.gap < 0).length}`;
    },
    sub: () => st.metric === 'gap' ? 'Difference between the share of registered Republicans who voted and the share of registered Democrats who voted, in percentage points.' : 'Each county is shaded by its value, in five groups with about the same number of counties each.',
    draw: (host, w, a) => { drawMap(host, w, a, st); sync(); },
    foot: null,
    notes: {
      what: 'A choropleth map shades each region by a value. Switch to bubbles and each county becomes a circle sized by its number of registered voters.',
      how: () => st.metric === 'gap' ? `Red counties are where Republicans vote at the higher rate, blue where Democrats do. Stronger color means a bigger gap. ${st.style === 'bubbles' ? 'Circle area shows how many voters live there.' : 'Click any county to select it.'}`
        : st.style === 'bubbles' ? 'Circle area shows how many voters live there. Color shows the metric you picked.' : `${deepWord()[0].toUpperCase() + deepWord().slice(1)} purple means a higher value. Pick another metric above; click any county to select it.`,
      shows: () => st.metric === 'gap' ? `Republicans lead in only **${C.filter(c => c.gap > 0).length}** counties, none with more than **${fComp(Math.max(...C.filter(c => c.gap > 0).map(c => c.reg)))}** registered voters. Democrats' turnout rate is ahead almost everywhere so far.` :`The five shades each hold about **${Math.round(N / 5)}** counties, so color shows rank, not exact values. Hover a county for the number.`,
      watch: 'Land area misleads. Big, quiet counties catch the eye while small, dense ones barely show. Flip to Bubbles to see where the voters really are.',
      nerd: { title: 'why quantile classes?', text: 'Turnout and ballot counts are lopsided: a few giant counties and many small ones. Slicing the range into equal-width bands would put most counties in one shade. Quantile classes give every shade roughly the same number of counties, so the map stays readable.' },
    },
    table: () => { const M = MAP_METRICS[st.metric]; return { head: ['County', M.label, 'Rank', 'Registered', 'Ballots'], align: ['l', 'n', 'n', 'n', 'n'], rows: [...C].sort((a, b) => M.val(b) - M.val(a)).map((c, i) => [c.name, M.fmt(M.val(c)), String(i + 1), fInt(c.reg), fInt(c.total)]) }; },
  });
  api.el.querySelector('.card-main').insertBefore(pick, api.el.querySelector('.card-foot'));
  return api;
}

/* ---- ranked bars: top and bottom ten, or everyone ---- */
function rankedList(all) {
  const me = scopeC();
  if (all) return BY_RATE;
  const top = BY_RATE.slice(0, 10), bot = BY_RATE.slice(-10);
  if (me && me.rank > 10 && me.rank <= N - 10) return [...top, ...(me.rank > 11 ? [{ sep: me.rank - 11 }] : []), me, ...(me.rank < N - 10 ? [{ sep: N - 10 - me.rank }] : []), ...bot];
  return [...top, { sep: N - 20 }, ...bot];
}
function drawRanked(host, w, api, all) {
  const list = rankedList(all);
  const rh = 24, bt = 14, m = { l: 112, r: 62, t: 24, b: 28 }, H = m.t + list.length * rh + m.b, iw = w - m.l - m.r;
  const top = niceTicks(BY_RATE[0].rate * 1.02, 5), x = linear(0, top.max, m.l, m.l + iw);
  const svg = svgBox(w, H); host.append(svg);
  axisX(svg, x, top.ticks, m.t, H - m.b, v => v + '%', H - m.b + 17);
  svg.append(s('line', { class: 'axisl', x1: crisp(m.l), x2: crisp(m.l), y1: m.t, y2: H - m.b }));
  list.forEach((c, i) => {
    const y = m.t + i * rh;
    if (c.sep != null) { svg.append(s('text', { class: 't-axis', x: m.l + 8, y: y + rh / 2 + 4 }, `· · ·  ${c.sep} ${c.sep === 1 ? 'county' : 'counties'} in between  · · ·`)); return; }
    const isSel = selection.i === c.i, bw = x(c.rate) - m.l;
    svg.append(s('text', { class: 't-lab', x: m.l - 10, y: y + rh / 2 + 4.5, 'text-anchor': 'end', style: { fontWeight: isSel ? 900 : 700 } }, `${all || selection.i === c.i ? c.rank + '. ' : ''}${c.name}`));
    const bar = s('path', { class: 'mark clickable', d: rrect(m.l, y + (rh - bt) / 2, bw, bt, { tr: 4, br: 4 }), fill: 'var(--early)', ...(isSel ? { stroke: 'var(--ink)', 'stroke-width': 2 } : {}) });
    hover(bar, () => tipContent(c.name, [{ label: 'Turnout', value: `${fPct(c.rate)}  (#${c.rank} of ${N})` }, { label: 'Ballots', value: fInt(c.total) }, { label: 'Registered', value: fInt(c.reg) }], pickHint));
    bar.addEventListener('click', () => selection.set(c.i));
    svg.append(bar, s('text', { class: 't-val', x: x(c.rate) + 7, y: y + rh / 2 + 4.5 }, fPct(c.rate)));
  });
  const sx = crisp(x(ST.rate));
  svg.append(s('line', { class: 'refl', x1: sx, x2: sx, y1: m.t - 6, y2: H - m.b }), s('text', { class: 't-note', x: sx + 6, y: m.t - 10 }, `Florida overall ${fPct(ST.rate)}`));
  api.label(`Counties ranked by turnout, ${all ? 'all 67' : 'the top 10 and bottom 10'}.`);
}
function rankedCard() {
  let all = false, api;
  const seg = segmented('Show', [[false, 'Top and bottom 10'], [true, 'All 67 counties']], false, v => { all = v; api.redraw(); });
  api = card({
    id: 'c-ranked', kicker: 'Ranked bar chart', cat: 'mochi', controls: [seg],
    title: () => { const me = scopeC(); if (me) { const d = me.rate - ST.rate; return `${me.name} is #${me.rank} of ${N} on turnout, ${Math.abs(d).toFixed(1)} points ${d >= 0 ? 'above' : 'below'} Florida`; } return `${(BY_RATE[0].rate - BY_RATE[N - 1].rate).toFixed(1)} points separate the highest and lowest county`; },
    sub: 'Turnout so far: ballots cast divided by active registered voters.',
    draw: (host, w, a) => drawRanked(host, w, a, all),
    notes: {
      what: 'A ranked bar chart lines categories up from biggest to smallest, so the eye can compare lengths without reading a single number.',
      how: 'Every bar starts at zero and its length is the value. The vertical line marks the statewide rate for reference.',
      shows: () => `**${BY_RATE[0].name}** leads at **${fPct(BY_RATE[0].rate)}**; **${BY_RATE[N - 1].name}** is last at **${fPct(BY_RATE[N - 1].rate)}**. The typical county (the median) sits at **${fPct(median(COUNTY_RATES))}**, below the statewide **${fPct(ST.rate)}**.`,
      watch: 'Always start bars at zero. Cutting the axis makes small gaps look enormous.',
    },
    table: () => ({ head: ['Rank', 'County', 'Turnout', 'Ballots', 'Registered'], align: ['n', 'l', 'n', 'n', 'n'], rows: BY_RATE.map(c => [String(c.rank), c.name, fPct(c.rate, 2), fInt(c.total), fInt(c.reg)]) }),
  });
  return api;
}

/* ---- the big sortable table with sparklines ---- */
function sparkline(vals, w = 92, ht = 24) {
  const mx = Math.max(...vals, 1), x = i => 2 + i / (vals.length - 1) * (w - 4), y = v => ht - 2 - v / mx * (ht - 4);
  return s('svg', { class: 'spark', width: w, height: ht, viewBox: `0 0 ${w} ${ht}`, 'aria-hidden': 'true' },
    s('path', { d: vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    s('circle', { cx: x(vals.length - 1), cy: y(vals[vals.length - 1]), r: 2.6, fill: 'var(--early)' }));
}
function tableCard() {
  const st = { key: 'rate', dir: -1, q: '' };
  const cols = [
    { k: 'rank', t: 'Rank', n: 1, v: c => c.rank }, { k: 'name', t: 'County', v: c => c.name },
    { k: 'reg', t: 'Registered', n: 1, v: c => c.reg }, { k: 'total', t: 'Ballots', n: 1, v: c => c.total },
    { k: 'rate', t: 'Turnout', v: c => c.rate }, { k: 'mailShare', t: 'By mail', n: 1, v: c => c.mailShare },
    { k: 'gap', t: 'Rep − Dem rate', n: 1, v: c => c.gap }, { k: 'day', t: 'Daily ballots', nosort: true },
  ];
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Find a county…', 'aria-label': 'Filter counties', oninput: e => { st.q = e.target.value.trim().toLowerCase(); api.redraw(); } });
  let api;
  api = card({
    id: 'c-table', kicker: 'Table with sparklines', cat: 'pearl', stack: true, noTable: true, controls: [search],
    title: 'All 67 counties, side by side',
    sub: () => scopeC() ? `Click a column to sort. ${scopeName()} is highlighted and scrolled into view. Click another row to switch counties.` : 'Click a column to sort. Click a row to tailor the whole page to that county.',
    foot: () => `${cols.length - 1} measures per county. Bars show turnout; the sparkline is ballots per day since voting began, with a dot on the latest day.`,
    draw: host => {
      const c0 = cols.find(c => c.k === st.key), rows = C.filter(c => c.name.toLowerCase().includes(st.q)).sort((a, b) => {
        const va = c0.v(a), vb = c0.v(b); return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * st.dir;
      });
      const mx = Math.max(...C.map(c => c.rate)) * 1.05;
      const head = h('tr', null, cols.map(c => h('th', { class: c.n ? 'n' : '', scope: 'col', 'aria-sort': st.key === c.k ? (st.dir > 0 ? 'ascending' : 'descending') : null },
        c.nosort ? h('span', { style: { padding: '10px 12px', display: 'block', fontWeight: 800, color: 'var(--ink-2)' } }, c.t) : h('button', { type: 'button', onclick: () => { st.dir = st.key === c.k ? -st.dir : (c.k === 'name' ? 1 : -1); st.key = c.k; api.redraw(); } }, c.t))));
      const body = rows.map(c => {
        const tr = h('tr', { class: selection.i === c.i ? 'sel' : '', tabindex: 0, onclick: () => selection.set(c.i), onkeydown: e => { if (e.key === 'Enter') selection.set(c.i); } },
          h('td', { class: 'n' }, String(c.rank)), h('td', { class: 'name' }, c.name), h('td', { class: 'n' }, fInt(c.reg)), h('td', { class: 'n' }, fInt(c.total)),
          h('td', null, h('div', { class: 'bar-cell' }, h('div', { class: 'trk' }, h('i', { style: { width: (100 * c.rate / mx) + '%' } })), h('b', null, fPct(c.rate)))),
          h('td', { class: 'n' }, fPct(c.mailShare, 0)),
          h('td', { class: 'n' }, h('span', { class: 'pill', style: { background: `color-mix(in oklab, ${c.gap > 0 ? 'var(--rep)' : 'var(--dem)'} 16%, transparent)` } }, fPts(c.gap))),
          h('td', null, sparkline(c.day.slice(START))));
        return tr;
      });
      host.append(h('p', { class: 'swipe-hint' }, 'Swipe the table sideways to see every column.'));
      const wrap = h('div', { class: 'dtable-wrap', tabindex: 0, role: 'region', 'aria-label': 'County table' }, h('table', { class: 'dtable' }, h('thead', null, head), h('tbody', null, body.length ? body : h('tr', null, h('td', { colspan: cols.length }, 'No county matches that search.')))));
      host.append(wrap);
      const mine = wrap.querySelector('tr.sel');
      if (mine && !st.q) requestAnimationFrame(() => { wrap.scrollTop = Math.max(0, mine.offsetTop - wrap.clientHeight / 2 + mine.offsetHeight / 2); });
    },
    notes: {
      what: 'A table is the right tool when you need exact numbers. A sparkline is a word-sized line chart that shows the shape of a trend without axes.',
      how: 'Sort by any column. The purple bar scales turnout. The pill is the Republican minus Democratic turnout rate in points: red means Republicans are ahead, blue means Democrats are.',
      shows: () => `Sorted by **${cols.find(c => c.k === st.key).t.toLowerCase()}**, ${st.dir < 0 ? 'highest' : 'lowest'} first. Try sorting by **Registered** to see that the biggest counties are not the ones with the highest turnout.`,
    },
  });
  return api;
}
