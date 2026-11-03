/* ---------- chapter 1 and 2: how many, and when ---------- */
const dayRows = ci => ci == null ? DAY : CDAY[ci].map((v, k) => ({ ...DAY[k], mail: v[0], early: v[1], ed: v[2], prov: v[3], total: v[0] + v[1] + v[2] + v[3] }));
const dayTable = ci => ({
  head: ['Date', 'Mail', 'Early voting', ...(HAS_ED ? ['Election Day'] : []), 'Total'],
  align: ['l', 'n', 'n', ...(HAS_ED ? ['n'] : []), 'n'],
  rows: dayRows(ci).slice(START).map(d => [d.long, fInt(d.mail), fInt(d.early), ...(HAS_ED ? [fInt(d.ed)] : []), fInt(d.total)]),
});

/* ---- stat tiles: Florida, or the selected county ---- */
function renderKpis(host) {
  const ci = scopeCi(), T = totalsFor(ci), c = scopeC(), pct = k => 100 * T[k] / T.reg;
  const rows = dayRows(ci).slice(START), peak = peakOf(rows);
  const tile = t => h('div', { class: 'kpi' },
    h('div', { class: 'l' }, t.dot ? h('i', { style: { background: t.dot } }) : null, t.l),
    h('div', { class: 'v' }, t.v), h('div', { class: 's' }, t.s),
    t.meter ? h('div', { class: 'meter', role: 'img', 'aria-label': `${fPct(T.rate)} of registered voters have voted` }, t.meter.map(m => h('i', { style: { width: m.w + '%', background: m.c } }))) : null);
  const open = C.filter(x => x.total > 0).length;
  clear(host).append(...[
    { l: 'Turnout so far', v: fPct(T.rate), s: ci == null ? `of ${fMil(T.reg)} active registered voters` : `of ${fInt(T.reg)} registered \u00b7 Florida ${fPct(ST.rate)}`,
      meter: [{ w: pct('mail'), c: 'var(--mail)' }, { w: pct('early'), c: 'var(--early)' }, ...(HAS_ED ? [{ w: pct('ed'), c: 'var(--ed)' }] : [])] },
    { l: 'By mail', dot: 'var(--mail)', v: fInt(T.mail), s: `${fPct(100 * T.mail / T.total)} of all ballots` },
    { l: 'Early, in person', dot: 'var(--early)', v: fInt(T.early), s: `${fPct(100 * T.early / T.total)} of all ballots` },
    { l: 'On Election Day', dot: 'var(--ed)', v: fInt(T.ed), s: HAS_ED ? `${fPct(100 * T.ed / T.total)} of all ballots` : `Polls open ${dinfo(ELECTION).short}, 7 AM to 7 PM` },
    { l: 'Busiest day so far', v: peak.short, s: `${fInt(peak.total)} ballots, ${peak.wd}` },
    ci == null ? { l: 'Counties reporting', v: `${open} of ${N}`, s: `${fInt(sum(C.map(x => x.precincts)))} precincts` }
      : { l: 'Rank by turnout', v: `#${c.rank}`, s: `of ${N} counties \u00b7 ${fInt(c.precincts)} precincts` },
  ].map(tile));
}

/* ---- pearl cup: a waffle chart where each pearl is 1% of registered voters ---- */
function pearlParts(T = ST) {
  const parts = [['mail', 'Mail', 'var(--mail)'], ['early', 'Early voting', 'var(--early)'], ...(HAS_ED ? [['ed', 'Election Day', 'var(--ed)']] : [])];
  let acc = 0, done = 0;
  return parts.map(([k, name, color]) => {
    const pct = 100 * T[k] / T.reg; acc += pct;
    const n = Math.round(acc) - done; done += n;               // round the running total so the pearls add up
    return { k, name, color, n, pct, ballots: T[k] };
  });
}
function drawCup(host, w, api) {
  const T = totalsFor(scopeCi());
  const size = Math.min(w, 420), p = clamp((size - 80) / 11, 14, 28), pad = p * .6, taper = p * .55;
  const gw = 10 * p, bw = gw + 2 * pad, tw = bw + 2 * taper, bodyH = 10 * p + 2 * pad + p * .5;
  const lidH = p * 1.5, strawH = p * 2.4, top = strawH + lidH * .4, cx = w / 2;
  const y0 = top + lidH, y1 = y0 + bodyH, H = Math.ceil(y1 + p * 1.5);
  const svg = svgBox(w, H); host.append(svg);
  const liquid = mix(css('--surface'), css('--early'), .13);
  // straw, body, pearls, lid
  svg.append(s('path', { d: `M${cx + tw * .1},${y0 - lidH * .6} L${cx + tw * .3},${top - strawH * .9}`, stroke: css('--cat-line'), 'stroke-width': 12, 'stroke-linecap': 'round', fill: 'none' }),
    s('path', { d: `M${cx + tw * .1},${y0 - lidH * .6} L${cx + tw * .3},${top - strawH * .9}`, stroke: css('--cat-pink'), 'stroke-width': 8, 'stroke-linecap': 'round', fill: 'none' }));
  svg.append(s('path', { d: `M${cx - tw / 2},${y0} L${cx + tw / 2},${y0} L${cx + bw / 2},${y1 - p * .7} Q${cx + bw / 2},${y1} ${cx + bw / 2 - p * .7},${y1} L${cx - bw / 2 + p * .7},${y1} Q${cx - bw / 2},${y1} ${cx - bw / 2},${y1 - p * .7} Z`,
    fill: liquid, stroke: css('--cat-line'), 'stroke-width': 2.4, 'stroke-linejoin': 'round' }));
  const parts = pearlParts(T), total = sum(parts.map(x => x.n));
  const groups = [...parts, { k: 'none', name: 'Not yet voted', color: null, n: 100 - total, pct: 100 - T.rate, ballots: T.reg - T.total }];
  const gEls = groups.map(() => s('g', { class: 'mark' }));
  let idx = 0;
  groups.forEach((g, gi) => {
    for (let j = 0; j < g.n; j++, idx++) {
      const row = Math.floor(idx / 10), col = idx % 10;
      const px = cx - gw / 2 + p / 2 + col * p, py = y1 - pad - p / 2 - row * p - p * .15, r = p * .41;
      gEls[gi].append(s('circle', g.color ? { cx: px, cy: py, r, fill: css(g.color.slice(4, -1)) } : { cx: px, cy: py, r: r * .9, fill: 'none', stroke: css('--axis'), 'stroke-width': 1.6 }));
      if (g.color) gEls[gi].append(s('circle', { cx: px - r * .32, cy: py - r * .34, r: r * .27, fill: '#fff', opacity: .5 }));
    }
  });
  svg.append(...gEls);
  svg.append(s('path', { d: `M${cx - tw / 2 - 5},${y0} Q${cx},${y0 - lidH * 2.1} ${cx + tw / 2 + 5},${y0} Z`, fill: css('--cup-lid'), stroke: css('--cat-line'), 'stroke-width': 2.4, 'stroke-linejoin': 'round' }),
    s('rect', { x: cx - tw / 2 - 9, y: y0 - 4, width: tw + 18, height: 10, rx: 5, fill: css('--cup-lid'), stroke: css('--cat-line'), 'stroke-width': 2.4 }));
  svg.append(s('text', { class: 't-note', x: cx, y: H - 4, 'text-anchor': 'middle' }, '1 pearl = 1% of active registered voters'));
  gEls.forEach((g, gi) => {
    const grp = groups[gi];
    g.setAttribute('tabindex', '0'); g.setAttribute('role', 'img'); g.setAttribute('aria-label', `${grp.name}: ${fPct(grp.pct)}`);
    hover(g, () => tipContent(grp.name, [{ color: grp.color, label: 'Share of registered voters', value: fPct(grp.pct) }, { label: grp.k === 'none' ? 'People' : 'Ballots', value: fInt(grp.ballots) }],
      grp.k === 'none' ? 'Active registered voters who have not cast a ballot yet' : null),
      { enter: () => gEls.forEach((o, k) => o !== g && o.classList.add('dim')), leave: () => gEls.forEach(o => o.classList.remove('dim')) });
  });
  api.label(`A boba cup of 100 pearls. ${fPct(T.rate)} of ${scopeC() ? scopeLabel() : 'Florida'}\u2019s registered voters have voted: ${parts.map(x => `${fPct(x.pct)} ${x.name.toLowerCase()}`).join(', ')}.`);
}

/* ---- daily columns, stacked by ballot type. ci = null for the state, or one county. ---- */
function drawDaily(host, w, api, ci = null, opt = {}) {
  const rows = dayRows(ci).slice(START), H = opt.h || clamp(Math.round(w * .3), 280, 360), m = { l: 50, r: 8, t: opt.small ? 14 : 32, b: 32 };
  const iw = w - m.l - m.r, ih = H - m.t - m.b, n = rows.length;
  const ty = niceTicks(Math.max(...rows.map(d => d.total), 1) * 1.04, opt.small ? 3 : 4), y = linear(0, ty.max, m.t + ih, m.t);
  const band = iw / n, bw = clamp(band * .72, 2, 24);
  const svg = svgBox(w, H); host.append(svg);
  rows.forEach((d, i) => { if (d.dow === 0 || d.dow === 6) svg.append(s('rect', { x: m.l + i * band, y: m.t, width: band, height: ih, fill: 'var(--empty)' })); });
  axisY(svg, y, ty.ticks, m.l, w - m.r, fComp);
  const hl = s('rect', { y: m.t, width: band, height: ih, fill: 'var(--axis)', opacity: 0, rx: 4 });
  svg.append(hl);
  rows.forEach((d, i) => {
    const x = m.l + band * (i + .5) - bw / 2;
    const segs = [[d.mail, 'var(--mail)'], [d.early, 'var(--early)'], [d.ed, 'var(--ed)']].filter(a => a[0] > 0);
    let base = y(0);
    segs.forEach(([v, col], j) => {
      const ht = y(0) - y(v), top = base - ht;
      svg.append(s('path', { class: 'mark', d: rrect(x, top, bw, Math.max(ht, .5), j === segs.length - 1 && ht > 5 ? { tl: Math.min(4, bw / 2), tr: Math.min(4, bw / 2) } : {}), fill: col }));
      base = top - 2;                                         // 2px of surface between segments
    });
    const hit = s('rect', { class: 'hit', x: m.l + i * band, y: m.t, width: band, height: ih + 6 });
    hover(hit, () => tipContent(d.long, [...typeRows(d.mail, d.early, d.ed), { label: 'Total', value: fInt(d.total) }],
      d.dow === 0 || d.dow === 6 ? 'Weekend' : null),
      { enter: () => { hl.setAttribute('x', m.l + i * band); hl.setAttribute('opacity', .55); }, leave: () => hl.setAttribute('opacity', 0) });
    svg.append(hit);
  });
  // weekly date labels
  const stride = Math.max(1, Math.ceil(48 / (band * 7)));
  rows.forEach((d, i) => { if (d.dow === 1 && Math.floor((d.ms - rows[0].ms) / 864e5 / 7) % stride === 0) svg.append(s('text', { class: 't-axis', x: m.l + band * (i + .5), y: m.t + ih + 19, 'text-anchor': 'middle' }, d.short)); });
  // annotations: the peak, and when early voting opened
  if (!opt.small) {
    const pi = rows.reduce((b, d, i) => d.total > rows[b].total ? i : b, 0), px = m.l + band * (pi + .5);
    const ptxt = `Peak ${rows[pi].short}: ${fComp(rows[pi].total)}`, pw = textW(ptxt, 12, 700);
    const anchor = px - pw / 2 < m.l ? 'start' : px + pw / 2 > w - 4 ? 'end' : 'middle';
    svg.append(s('text', { class: 't-note', x: anchor === 'start' ? m.l : anchor === 'end' ? w - 4 : px, y: m.t - 12, 'text-anchor': anchor }, ptxt));
    const oi = rows.findIndex(d => d.iso === (EV_OPEN && EV_OPEN.iso));
    if (ci == null && oi >= 0) {
      const ox = m.l + band * oi, label = 'Early voting opens', lw = textW(label, 12, 700);
      const free = Math.abs((anchor === 'start' ? m.l + pw / 2 : anchor === 'end' ? w - 4 - pw / 2 : px) - (ox + lw / 2)) > (pw + lw) / 2 + 12;
      svg.append(s('line', { x1: crisp(ox), x2: crisp(ox), y1: m.t - 4, y2: m.t + ih, stroke: 'var(--ink-3)', 'stroke-width': 1 }));
      if (free) svg.append(s('text', { class: 't-note', x: ox + 5, y: m.t - 12 }, label));
    }
  }
  api.label(`Daily ballots as stacked columns of mail and early voting, ${rows[0].short} to ${rows[n - 1].short}. Busiest day ${PEAK.short}.`);
}

/* ---- cumulative lines, for Florida or one county (with Florida as the reference line) ---- */
function drawCumulative(host, w, api, valueMode) {
  const ci = scopeCi(), T = totalsFor(ci), all = dayRows(ci), rows = all.slice(START), n = rows.length, pct = valueMode === 'pct';
  const cum = ci == null ? CUM : cumulativeOf(all);
  const val = (key, i) => pct ? 100 * cum[key][START + i] / T.reg : cum[key][START + i];
  const full = (key, i) => `${fInt(cum[key][START + i])}  (${fPct(100 * cum[key][START + i] / T.reg)})`;
  const series = [
    { name: 'Total', color: 'var(--ink)', key: 'total', width: 2.5 }, { name: 'Early voting', color: 'var(--early)', key: 'early' }, { name: 'Mail', color: 'var(--mail)', key: 'mail' },
    ...(HAS_ED ? [{ name: 'Election Day', color: 'var(--ed)', key: 'ed' }] : []),
  ].map(se => ({ ...se, ys: rows.map((_, i) => val(se.key, i)), tip: i => pct ? `${fPct(val(se.key, i))}  (${fComp(cum[se.key][START + i])})` : full(se.key, i) }));
  if (ci != null && pct) series.push({ name: 'Florida', color: 'var(--ink-3)', width: 1.5, ys: rows.map((_, i) => 100 * CUM.total[START + i] / ST.reg), tip: i => fPct(100 * CUM.total[START + i] / ST.reg) });
  const oi = rows.findIndex(d => EV_OPEN && d.iso === EV_OPEN.iso);
  kitLines(host, w, rows.map(d => d.ms), series, {
    height: clamp(Math.round(w * .3), 300, 380), yFmt: v => pct ? v + '%' : fComp, endFmt: v => pct ? fPct(v) : fComp(v),
    xFmt: (ms, i) => rows[i].short, tipHead: i => `Through ${rows[i].long}`, vlines: oi >= 0 ? [{ x: rows[oi].ms, label: 'Early voting opens' }] : [],
  });
  api.label(`Cumulative ballots cast in ${scopeLabel()}, ${rows[0].short} to ${rows[n - 1].short}, ending at ${fPct(T.rate)} of registered voters.`);
}

/* ---- calendar heatmap: one cell per day ---- */
function drawCalendar(host, w, api) {
  const rowsAll = dayRows(scopeCi()), byIso = new Map(rowsAll.map(d => [d.iso, d])), peakRow = peakOf(rowsAll.slice(START));
  const start = addDays(DAY[START].iso, -dinfo(DAY[START].iso).dow), endIso = ELECTION > DAY[DAY.length - 1].iso ? ELECTION : DAY[DAY.length - 1].iso;
  const weeks = Math.floor((dinfo(endIso).ms - dinfo(start).ms) / 864e5 / 7) + 1;
  const labW = 52, cell = clamp((w - labW) / 7, 36, 66), gap = 4, headH = 24, H = headH + weeks * cell + 54;
  const max = Math.max(...rowsAll.map(d => d.total), 1), svg = svgBox(w, H); host.append(svg);
  const long = cell >= 50;
  (long ? WD : WD.map(d => d[0])).forEach((d, i) => svg.append(s('text', { class: 't-axis', x: labW + i * cell + cell / 2, y: 14, 'text-anchor': 'middle' }, d)));
  for (let wk = 0; wk < weeks; wk++) {
    svg.append(s('text', { class: 't-axis', x: labW - 10, y: headH + wk * cell + cell / 2 + 4, 'text-anchor': 'end' }, dinfo(addDays(start, wk * 7)).short));
    for (let dw = 0; dw < 7; dw++) {
      const iso = addDays(start, wk * 7 + dw), d = byIso.get(iso), info = dinfo(iso);
      const x = labW + dw * cell + gap / 2, yy = headH + wk * cell + gap / 2, sz = cell - gap;
      if (iso < DAY[START].iso) continue;
      if (!d) {                                           // days after the last data day
        const isEd = iso === ELECTION;
        svg.append(s('rect', { x, y: yy, width: sz, height: sz, rx: 8, fill: isEd ? 'none' : 'var(--empty)', stroke: isEd ? 'var(--early)' : 'none', 'stroke-width': 2, 'stroke-dasharray': isEd ? '5 4' : null, opacity: isEd || iso < ELECTION ? 1 : .55 }),
          s('text', { class: 't-axis', x: x + 6, y: yy + 14 }, info.d));
        if (isEd) svg.append(use('paw', { x: x + sz / 2 - 9, y: yy + sz / 2 - 14, width: 18, height: 18, fill: 'var(--early)' }),
          s('text', { class: 't-note', x: x + sz / 2, y: yy + sz - 19, 'text-anchor': 'middle', 'font-size': 11 }, 'Election'),
          s('text', { class: 't-note', x: x + sz / 2, y: yy + sz - 7, 'text-anchor': 'middle', 'font-size': 11 }, 'Day'));
        continue;
      }
      const fill = d.total ? seqColor(d.total / max) : css('--empty'), ink = onFill(fill);
      const c = s('rect', { class: 'cell clickable', x, y: yy, width: sz, height: sz, rx: 8, fill, tabindex: 0, role: 'img', 'aria-label': `${d.long}: ${fInt(d.total)} ballots` });
      hover(c, () => tipContent(d.long, [...typeRows(d.mail, d.early, d.ed), { label: 'Total', value: fInt(d.total) }]));
      svg.append(c, s('text', { x: x + 6, y: yy + 14, 'font-size': 11, 'font-weight': 800, fill: ink, 'pointer-events': 'none' }, info.d));
      if (cell >= 48 && d.total) svg.append(s('text', { x: x + sz / 2, y: yy + sz - 8, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 800, fill: ink, 'pointer-events': 'none' }, fComp(d.total)));
    }
  }
  gradientLegend(svg, labW, H - 36, Math.min(7 * cell, w - labW), 10, 'fewer ballots', `more ballots (${fComp(max)} on the busiest day)`);
  api.label(`Calendar heatmap of daily ballots in ${scopeLabel()}. The busiest day is ${peakRow.long}.`);
}

/* ---------- cards: how many, and when ---------- */
const PEAK_OF_SCOPE = () => peakOf(dayRows(scopeCi()).slice(START));
function pearlCard() {
  return card({
    id: 'c-cup', kicker: 'Waffle chart', cat: 'mochi',
    title: () => { const T = totalsFor(scopeCi()); return `About ${Math.round(T.rate)} of every 100 registered voters ${scopeC() ? 'in ' + scopeC().name + ' ' : ''}have voted`; },
    sub: () => `Each pearl is 1% of ${scopeC() ? scopeLabel() + '’s' : 'Florida’s'} active registered voters.`,
    legend: () => [...typeLegend(), { color: 'var(--axis)', type: 'ring', label: 'Not yet voted' }],
    draw: drawCup,
    notes: {
      what: 'A waffle chart turns one percentage into 100 equal squares, here pearls, so you can see a share instead of reading it. It is a friendlier cousin of the pie chart.',
      how: 'Filled pearls have voted, colored by how. Empty rings have not. The cup fills from the bottom, like pearls settling.',
      shows: () => {
        const T = totalsFor(scopeCi()), ed = HAS_ED ? `**${fPct(100 * T.ed / T.reg)}** on Election Day. That leaves` : 'That leaves';
        return `**${fPct(T.rate)}** of active registered voters have cast a ballot: **${fPct(100 * T.mail / T.reg)}** by mail, **${fPct(100 * T.early / T.reg)}** early in person${HAS_ED ? ',' : '.'} ${ed} **${fInt(T.reg - T.total)}** people who have not voted yet.${scopeC() ? ` Florida overall: **${fPct(ST.rate)}**.` : ''}`;
      },
      watch: 'Pearls are rounded to whole percents. Hover for the exact numbers.',
    },
    table: () => { const T = totalsFor(scopeCi()); return { head: ['Group', 'Ballots or people', '% of registered'], align: ['l', 'n', 'n'],
      rows: [...pearlParts(T).map(x => [x.name, fInt(x.ballots), fPct(x.pct, 2)]), ['Not yet voted', fInt(T.reg - T.total), fPct(100 - T.rate, 2)]] }; },
  });
}
function dailyCard() {
  return card({
    id: 'c-daily', kicker: 'Stacked column chart', cat: 'mochi', stack: true,
    title: () => { const pk = PEAK_OF_SCOPE(); return scopeC() ? `${scopeC().name} voters peaked on ${pk.long}` : `Voting surged once early voting opened, and peaked on ${pk.long}`; },
    sub: () => `Ballots recorded each day in ${scopeLabel()}, split by how they were cast.`,
    legend: () => [...typeLegend(), { color: 'var(--empty)', border: true, label: 'Weekend' }], draw: (host, w, api) => drawDaily(host, w, api, scopeCi()),
    notes: {
      what: 'A column chart draws one bar per day, so the height is that day’s count. Stacking splits each bar into parts that add up to the day’s total.',
      how: 'Read the whole bar for the day’s total and each color for its share. Bars start at zero, so heights compare fairly.',
      shows: () => { const pk = PEAK_OF_SCOPE(); return `**${pk.long}** was ${scopeC() ? scopeName() + '’s' : 'the'} busiest day with **${fInt(pk.total)}** ballots. Mail arrives steadily from late September; in-person early voting adds a surge from **${EV_OPEN ? EV_OPEN.short : 'opening day'}**.`; },
      watch: 'Mail counts nearly vanish on early Sundays (before early voting opened). That looks like office schedules, not voters taking weekends off.',
      nerd: { title: 'columns vs lines', text: 'Daily counts are separate events, so bars are the honest shape. A line would imply values between the days. Lines are better for running totals, which is the next chart.' },
    },
    table: () => dayTable(scopeCi()),
  });
}
function cumulativeCard() {
  let valueMode = 'pct', api;
  const seg = segmented('Show', [['pct', '% of registered voters'], ['n', 'Number of ballots']], 'pct', v => { valueMode = v; api.redraw(); });
  api = card({
    id: 'c-cum', kicker: 'Line chart', cat: 'mochi', stack: true, controls: [seg],
    title: () => { const T = totalsFor(scopeCi()); return scopeC() ? `${scopeC().name} turnout has reached ${fPct(T.rate)} (Florida ${fPct(ST.rate)})` : `Turnout has reached ${fPct(T.rate)} so far`; },
    sub: () => `Everyone in ${scopeLabel()} who has voted so far, added up day by day.`,
    legend: () => [{ type: 'line', color: 'var(--ink)', label: 'Total' }, { type: 'line', color: 'var(--early)', label: 'Early voting' }, { type: 'line', color: 'var(--mail)', label: 'Mail' }, ...(HAS_ED ? [{ type: 'line', color: 'var(--ed)', label: 'Election Day' }] : []), ...(scopeC() && valueMode === 'pct' ? [{ type: 'line', color: 'var(--ink-3)', label: 'Florida overall' }] : [])],
    draw: (host, w, a) => drawCumulative(host, w, a, valueMode),
    notes: {
      what: 'A cumulative line adds each day’s ballots to everything before it. Because nobody un-votes, the line only goes up.',
      how: 'Steeper means a busier stretch. Flat means a quiet one. The last point is where things stand now.',
      shows: () => {
        const ci = scopeCi(), T = totalsFor(ci), cum = ci == null ? CUM : cumulativeOf(dayRows(ci)), x = DAY.slice(START).find((d, i) => cum.early[START + i] >= cum.mail[START + i]);
        return `${scopeC() ? scopeName() + '’s' : 'Total'} turnout is **${fPct(T.rate)}**. Early voting (**${fPct(100 * T.early / T.reg)}**) ${x ? `overtook mail (**${fPct(100 * T.mail / T.reg)}**) on **${x.short}**` : 'trails mail'}.`;
      },
      watch: 'The vertical axis shows a share of all registered voters, not of people who have voted.',
      nerd: { title: 'daily vs cumulative', text: 'Daily counts and running totals are two views of one dataset. Daily shows rhythm (weekends, surges). Cumulative shows progress toward a goal. Use whichever answers your question.' },
    },
    table: () => { const ci = scopeCi(), T = totalsFor(ci), cum = ci == null ? CUM : cumulativeOf(dayRows(ci)); return { head: ['Date', 'Mail so far', 'Early so far', ...(HAS_ED ? ['Election Day so far'] : []), 'Total so far', '% of registered'], align: ['l', 'n', 'n', ...(HAS_ED ? ['n'] : []), 'n', 'n'],
      rows: DAY.slice(START).map((d, i) => [d.long, fInt(cum.mail[START + i]), fInt(cum.early[START + i]), ...(HAS_ED ? [fInt(cum.ed[START + i])] : []), fInt(cum.total[START + i]), fPct(100 * cum.total[START + i] / T.reg)]) }; },
  });
  return api;
}
function calendarCard() {
  const stats = () => weekdayStats(dayRows(scopeCi()));
  return card({
    id: 'c-cal', kicker: 'Calendar heatmap', cat: 'mochi',
    title: () => { const st = stats(); return `${scopeC() ? scopeName() + ': ' : ''}${WDNAME[st.best]}s were the busiest weekday and ${WDNAME[st.worst]}s the quietest`; },
    sub: () => `Ballots recorded per day in ${scopeLabel()} during early voting and mail. ${deepWord()[0].toUpperCase() + deepWord().slice(1)} means busier.`,
    draw: drawCalendar,
    notes: {
      what: 'A heatmap swaps numbers for colors. A calendar heatmap lays days out like a wall calendar, so weekly habits show up as stripes.',
      how: () => `Each square is a day. ${deepWord()[0].toUpperCase() + deepWord().slice(1)} purple means more ballots. Rows are weeks, columns are weekdays.`,
      shows: () => { const st = stats(), pk = PEAK_OF_SCOPE(); return `**${pk.long}** is the busiest square (**${fInt(pk.total)}** ballots). Across the early-voting window, **${WDNAME[st.best]}s** averaged the most ballots (**${fComp(st.avg[st.best])}**) and **${WDNAME[st.worst]}s** the fewest (**${fComp(st.avg[st.worst])}**).`; },
      watch: 'Color is great for spotting patterns and bad for reading exact values. Hover a square, or use the table view.',
    },
    table: () => dayTable(scopeCi()),
  });
}
