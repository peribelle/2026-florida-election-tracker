/* ---------- chapter: busiest sites and days ---------- */
const TOP_SITES = SITES.slice(0, 15);
const siteMix = s2 => { const t = sum(Object.values(s2.p)) || 1; return PARTIES.map(g => ({ color: g.color, label: g.short, value: fPct(100 * s2.p[g.k] / t, 0) })); };

/* ---- busiest early-voting sites: ranked bars, libraries in the accent color ---- */
const siteRows = () => scopeC() ? SITES.filter(x => x.c === scopeCi()).sort((a, b) => b.t - a.t).slice(0, 15) : TOP_SITES;
function drawSites(host, w, api) {
  const rows = siteRows();
  if (!rows.length) { emptyCard(host, `No early-voting site in ${scopeLabel()} reported ballots yet.`); api.label('No sites.'); return; }
  const rh = 40, bt = 16, m = { l: Math.min(250, w * .42), r: 64, t: 4, b: 28 }, H = m.t + rows.length * rh + m.b, iw = w - m.l - m.r;
  const tk = niceTicks(rows[0].t * 1.04, 4), x = linear(0, tk.max, m.l, m.l + iw), svg = svgBox(w, H); host.append(svg);
  axisX(svg, x, tk.ticks, m.t, H - m.b, fComp, H - m.b + 17);
  svg.append(s('line', { class: 'axisl', x1: crisp(m.l), x2: crisp(m.l), y1: m.t, y2: H - m.b }));
  rows.forEach((st, i) => {
    const y = m.t + i * rh, cy = y + rh / 2;
    svg.append(s('text', { class: 't-lab', x: m.l - 10, y: cy - 2, 'text-anchor': 'end' }, fitText(st.name, 13, 700, m.l - 18)), s('text', { class: 't-axis', x: m.l - 10, y: cy + 13, 'text-anchor': 'end' }, scopeC() ? fitText(st.a || st.county, 12, 600, m.l - 18) : st.county));
    const bar = s('path', { class: 'mark clickable', d: rrect(m.l, cy - bt / 2, x(st.t) - m.l, bt, { tr: 4, br: 4 }), fill: st.lib ? 'var(--early)' : 'var(--oth)' });
    hover(bar, () => tipContent(st.name, [{ label: 'Ballots cast here', value: fInt(st.t) }, ...siteMix(st)], [st.county + ' County', st.a || null].filter(Boolean)));
    bar.addEventListener('click', () => selection.set(st.c));
    svg.append(bar, s('text', { class: 't-val', x: x(st.t) + 7, y: cy + 4.5 }, fComp(st.t)));
  });
  api.label(`The early-voting sites with the most ballots${scopeC() ? ` in ${scopeLabel()}` : ''}.`);
}
function sitesCard() {
  return card({
    id: 'c-sites', kicker: 'Ranked bar chart with emphasis', cat: 'mochi',
    title: () => { const r = siteRows(); if (scopeC()) return r.length ? `${scopeName()}’s busiest early-voting site is ${r[0].name}, with ${fInt(r[0].t)} ballots` : `No early-voting ballots are recorded by site in ${scopeName()} yet`; return `${TOP_SITES.filter(x => x.lib).length} of the 15 busiest early-voting sites are libraries`; },
    sub: () => { const r = siteRows(); if (scopeC()) return r.length ? `${plural(SITES.filter(x => x.c === scopeCi()).length, 'site')} reported ballots in ${scopeLabel()}${r.length < SITES.filter(x => x.c === scopeCi()).length ? '; the top 15 are shown' : ''}.` : ''; return `The busiest was ${TOP_SITES[0].name} in ${TOP_SITES[0].county} County, with ${fInt(TOP_SITES[0].t)} ballots.`; },
    legend: () => [{ color: 'var(--early)', label: 'Library (name contains “Lib”)' }, { color: 'var(--oth)', label: 'Other venue' }],
    foot: () => `${fInt(scopeC() ? SITES.filter(x => x.c === scopeCi()).length : SITES.length)} early-voting sites reported ballots${scopeC() ? ` in ${scopeName()}` : ''}. Site totals include a few provisional ballots.`,
    draw: drawSites,
    notes: {
      what: 'Emphasis is a way to say "look at this group". One category gets the bright color and the rest fade to gray, so your eye lands on the pattern without a rainbow.',
      how: 'Bars rank sites by ballots cast. Purple bars are libraries. Hover a bar for the party mix of the people who voted there.',
      shows: () => { if (scopeC()) { const r = SITES.filter(x => x.c === scopeCi()); return r.length ? `**${scopeName()}** has **${r.length}** reporting site${r.length === 1 ? '' : 's'}; the median saw **${fInt(median(r.map(x => x.t)))}** ballots, against **${fInt(median(SITES.map(x => x.t)))}** for the median site statewide.` : 'No site-level counts for this county yet.'; } return `Libraries hold **${TOP_SITES.filter(x => x.lib).length}** of the top 15 spots, and the top site, **${TOP_SITES[0].name}**, drew **${fInt(TOP_SITES[0].t)}** ballots. The median site saw **${fInt(median(SITES.map(x => x.t)))}**.`; },
      watch: 'Big sites are in big counties, so this ranks locations by traffic, not by how popular voting is nearby.',
    },
    table: () => ({ head: ['Site', 'County', 'Ballots'], align: ['l', 'l', 'n'], rows: (scopeC() ? SITES.filter(x => x.c === scopeCi()).sort((a, b) => b.t - a.t) : SITES).slice(0, 100).map(x => [x.name, x.county, fInt(x.t)]) }),
  });
}

/* ---- heatmap: county by day, as a share of the county's own ballots ---- */
const evStart = () => { const i = DAY.findIndex(d => EV_OPEN && d.iso === EV_OPEN.iso); return i < 0 ? START : i; };
const heatRows = all => { const ci = scopeCi(), byTotal = [...C].sort((a, b) => b.total - a.total); return all ? byTotal : ci != null ? [C[ci], ...peersOf(ci, 11)] : byTotal.slice(0, 25); };
function drawHeat(host, w, api, all) {
  const ci = scopeCi(), rowsC = heatRows(all);
  const first = evStart(), cols = DAY.slice(first), n = cols.length;
  const rh = all ? 14 : 20, m = { l: 108, r: 8, t: 50, b: 40 }, iw = w - m.l - m.r, cw = iw / n, H = m.t + rowsC.length * rh + m.b;
  const share = (c, k) => c.total ? 100 * c.day[first + k] / c.total : 0;
  const max = Math.max(...rowsC.flatMap(c => cols.map((_, k) => share(c, k)))), svg = svgBox(w, H); host.append(svg);
  cols.forEach((d, k) => {
    const cx = m.l + cw * (k + .5), weekend = d.dow === 0 || d.dow === 6;
    svg.append(s('text', { class: 't-axis', x: cx, y: m.t - 22, 'text-anchor': 'middle', style: { fontWeight: weekend ? 800 : 600, fontSize: cw < 24 ? '10px' : '12px' } }, WD[d.dow][0]),
      s('text', { class: 't-axis', x: cx, y: m.t - 8, 'text-anchor': 'middle' }, cw > 26 || k % 2 === 0 ? String(d.d) : ''));
  });
  cols.forEach((d, k) => { if (k === 0 || d.d === 1) svg.append(s('text', { class: 't-note', x: m.l + cw * k + 2, y: m.t - 34 }, MON[d.m - 1])); });
  rowsC.forEach((c, i) => {
    const y = m.t + i * rh;
    svg.append(s('text', { class: 't-lab', x: m.l - 8, y: y + rh / 2 + 4, 'text-anchor': 'end', style: { fontSize: all ? '11px' : '13px', fontWeight: c.i === ci ? 900 : 700 } }, c.name));
    cols.forEach((d, k) => {
      const v = share(c, k), cell = s('rect', { class: 'cell', x: m.l + k * cw + 1, y: y + 1, width: Math.max(cw - 2, 1), height: rh - 2, rx: 3, fill: v > 0 ? seqColor(v / max) : css('--empty'), tabindex: all ? null : 0 });
      hover(cell, () => tipContent(`${c.name}, ${d.long}`, [{ label: 'Ballots that day', value: fInt(c.day[first + k]) }, { label: 'Share of its ballots so far', value: fPct(v) }]));
      svg.append(cell);
    });
    if (c.i === ci) svg.append(s('rect', { x: m.l - 1, y: y, width: iw + 2, height: rh, rx: 4, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'pointer-events': 'none' }));
  });
  gradientLegend(svg, m.l, H - 30, Math.min(260, iw), 9, '0%', iw < 420 ? `${max.toFixed(0)}% in a day` : `${max.toFixed(0)}% of a county’s ballots in one day`);
  api.label('Heatmap of each county’s ballots by day, as a share of that county’s total.');
}
function heatCard() {
  let all = false, api;
  const seg = live(h('div'), () => segmented('Rows', [[false, scopeC() ? `${scopeName()} and 11 similar-size counties` : '25 biggest counties'], [true, 'All 67']], all, v => { all = v; api.redraw(); }));
  api = card({
    id: 'c-heat', kicker: 'Heatmap', cat: 'mochi', stack: true, controls: [seg],
    title: () => scopeC() ? (all ? `${scopeName()} (outlined) against every county: who voted when?` : `${scopeName()} next to counties of similar size: who voted when?`) : 'Every county has its own rhythm: some rush early, some wait for the last days',
    sub: 'Each row is a county. Each column is a day. Color is the share of that county’s ballots (so far) that were recorded that day.',
    draw: (host, w, a) => drawHeat(host, w, a, all),
    notes: {
      what: 'A heatmap is a grid where color stands in for a number. It is the right choice when you have many rows and many columns and want the pattern more than the figures.',
      how: () => `${deepWord()[0].toUpperCase() + deepWord().slice(1)} cells are the busiest days for that county. We divide by each county’s own total so Miami-Dade does not drown out the small counties.`,
      shows: () => {
        const big = [...C].sort((a, b) => b.total - a.total).slice(0, 25), lastIdx = DAY.indexOf(EV_LAST || DAY[DAY.length - 1]), final3 = [lastIdx - 2, lastIdx - 1, lastIdx];
        const f = c => c.total ? 100 * sum(final3.map(i => c.day[i])) / c.total : 0, byF = [...big].sort((a, b) => f(b) - f(a));
        if (scopeC()) { const me = scopeC(), peers = peersOf(me.i, 11); return `In the last three days of the early-voting window (${DAY[final3[0]].short} to ${DAY[final3[2]].short}), **${me.name}** recorded **${fPct(f(me), 0)}** of its ballots so far. Its ${peers.length} closest peers in size recorded a median of **${fPct(median(peers.map(f)), 0)}**.`; }
        return `On the last three days of the early-voting window (${DAY[final3[0]].short} to ${DAY[final3[2]].short}), **${byF[0].name}** recorded **${fPct(f(byF[0]), 0)}** of its ballots so far, while **${byF[byF.length - 1].name}** recorded **${fPct(f(byF[byF.length - 1]), 0)}**.`;
      },
      watch: 'Normalizing hides size. A dark cell in a small county can be a few hundred ballots. Hover to see the real count.',
    },
    table: () => { const f0 = evStart(); return { head: ['County', 'Total ballots', ...DAY.slice(f0).map(d => d.short)], align: ['l', ...DAY.slice(f0 - 1).map(() => 'n')], rows: [...C].sort((a, b) => b.total - a.total).map(c => [c.name, fInt(c.total), ...c.day.slice(f0).map(fInt)]) }; },
  });
  return api;
}

/* ---- small multiples: the same chart, once per county ---- */
function miniDaily(c, w, ht, ymax, showMax) {
  const rows = dayRows(c.i).slice(START), n = rows.length, band = w / n, bw = Math.max(1, band * .78), y = linear(0, ymax, ht - 16, 4);
  const svg = svgBox(w, ht);
  rows.forEach((d, i) => {
    const x = i * band + (band - bw) / 2; let base = y(0);
    [[d.mail, 'var(--mail)'], [d.early, 'var(--early)'], [d.ed, 'var(--ed)']].forEach(([v, col]) => { if (v > 0) { const hh = y(0) - y(v); svg.append(s('rect', { x, y: base - hh, width: bw, height: Math.max(hh, .5), fill: col })); base -= hh; } });
    const hit = s('rect', { class: 'hit', x: i * band, y: 0, width: band, height: ht });
    hover(hit, () => tipContent(`${c.name}, ${d.long}`, [...typeRows(d.mail, d.early, d.ed), { label: 'Total', value: fInt(d.total) }]));
    svg.append(hit);
  });
  svg.append(s('line', { class: 'axisl', x1: 0, x2: w, y1: crisp(y(0)), y2: crisp(y(0)) }));
  if (showMax) svg.append(s('text', { class: 't-axis', x: 0, y: 12 }, `max ${fComp(Math.max(...rows.map(d => d.total)))}`));
  svg.append(s('text', { class: 't-axis', x: 0, y: ht - 2 }, rows[0].short), s('text', { class: 't-axis', x: w, y: ht - 2, 'text-anchor': 'end' }, rows[n - 1].short));
  return svg;
}
const smallSet = () => scopeC() ? [scopeC(), ...peersOf(scopeCi(), 11)] : TOP15.slice(0, 12);
function drawSmall(host, w, api, shared) {
  const cols = w >= 900 ? 4 : w >= 600 ? 3 : 2, gap = 14, cw = Math.floor((w - gap * (cols - 1)) / cols), big = smallSet();
  const gmax = Math.max(...big.map(c => Math.max(...dayRows(c.i).slice(START).map(d => d.total))));
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cw}px)`, gap: `${gap + 4}px ${gap}px` } });
  big.forEach(c => {
    const ymax = shared ? gmax * 1.05 : Math.max(...dayRows(c.i).slice(START).map(d => d.total)) * 1.08;
    grid.append(h('div', null,
      h('button', { type: 'button', style: { all: 'unset', cursor: 'pointer', font: `${c.i === selection.i ? 800 : 600} .95rem/1.2 var(--font-display)`, color: 'var(--ink)', display: 'block', ...(c.i === selection.i ? { textDecoration: 'underline', textUnderlineOffset: '3px' } : {}) }, onclick: () => selection.set(c.i) }, c.name),
      h('div', { style: { fontSize: '.75rem', fontWeight: 600, color: 'var(--ink-3)', marginBottom: '2px' } }, `${fComp(c.total)} ballots`),
      miniDaily(c, cw, 118, ymax, !shared)));
  });
  host.append(grid);
  api.label(scopeC() ? `Twelve small charts: ${scopeLabel()} and the eleven counties closest to it in size, each showing ballots per day.` : 'Twelve small charts, one per large county, each showing ballots per day.');
}
function smallCard() {
  let shared = true, api;
  const seg = segmented('Vertical scale', [[true, 'Same scale for all'], [false, 'Each its own scale']], true, v => { shared = v; api.redraw(); });
  api = card({
    id: 'c-small', kicker: 'Small multiples', cat: 'pearl', stack: true, controls: [seg],
    title: () => scopeC() ? `${scopeName()} and its 11 closest peers: do they vote on the same rhythm?` : 'Same chart, twelve counties: the shape repeats, the size does not',
    sub: () => `Daily ballots for ${scopeC() ? `${scopeName()} (first panel) and the 11 counties closest to it in size` : 'the 12 counties with the most ballots'}. ${shared ? 'Every panel uses the same vertical scale.' : 'Each panel has its own vertical scale; the number at its top left is its tallest day.'}`,
    legend: typeLegend, draw: (host, w, a) => drawSmall(host, w, a, shared),
    notes: {
      what: 'Small multiples repeat one small chart for each group, using the same axes, so your eye can compare shapes at a glance. It is often clearer than cramming twelve lines into one chart.',
      how: 'Each panel is a county. Columns are days, colored by mail and early voting. With a shared scale, taller means more ballots on any panel. With separate scales, only the shape is comparable.',
      shows: () => { const twelve = smallSet(), mailer = [...twelve].sort((a, b) => b.mailShare - a.mailShare)[0]; if (scopeC()) return `**${scopeName()}** is the first panel. Among these twelve counties, **${mailer.name}** leans on mail most (**${fPct(mailer.mailShare, 0)}** of its ballots); ${scopeName()} is at **${fPct(scopeC().mailShare, 0)}**.`; return `With a shared scale, **${twelve[0].name}** dwarfs the rest. Switch to separate scales and the shapes become comparable: most show a mail trickle and then an early-voting surge from ${EV_OPEN ? EV_OPEN.short : 'the opening day'}, though **${mailer.name}** leans on mail far more (**${fPct(mailer.mailShare, 0)}** of its ballots).`; },
      watch: 'Separate scales make small counties look as busy as big ones. Say so when you show them.',
    },
    table: () => ({ head: ['County', 'Total ballots', 'Busiest day', 'Ballots that day'], align: ['l', 'n', 'l', 'n'], rows: smallSet().map(c => { const d = dayRows(c.i).reduce((b, x) => x.total > b.total ? x : b); return [c.name, fInt(c.total), d.long, fInt(d.total)]; }) }),
  });
  return api;
}
