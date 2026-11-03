/* ---------- chapter: party. Party is a voter's registration, not a vote. ---------- */
const partyLegend = () => PARTIES.map(g => ({ color: g.color, label: g.name }));
const PS = () => partyStatsFor(scopeCi());                       // party groups for Florida or for the selected county
const byPartyRate = () => [...PS()].sort((a, b) => b.rate - a.rate);
const partyOf = k => PS().find(g => g.k === k);
const mailOf = g => { const t = g.mail + g.early + g.ed; return t ? 100 * g.mail / t : 0; };
const inScope = () => scopeC() ? ` in ${scopeLabel()}` : '';
const partyName = g => g.k === 'NPA' ? 'No party' : g.name;

/* ---- turnout rate by party ---- */
function drawPartyRate(host, w, api) {
  const ci = scopeCi(), rows = byPartyRate(), T = totalsFor(ci), rh = 64, bt = 24, m = { l: 138, r: 64, t: 26, b: 30 }, H = m.t + rows.length * rh + m.b, iw = w - m.l - m.r;
  const top = niceTicks(Math.max(rows[0].rate, T.rate, ...(ci != null ? rows.map(g => PARTY[g.k].rate) : [])) * 1.08, 5), x = linear(0, top.max, m.l, m.l + iw);
  const svg = svgBox(w, H); host.append(svg);
  axisX(svg, x, top.ticks, m.t, H - m.b, v => v + '%', H - m.b + 17);
  svg.append(s('line', { class: 'axisl', x1: crisp(m.l), x2: crisp(m.l), y1: m.t, y2: H - m.b }));
  rows.forEach((g, i) => {
    const y = m.t + i * rh + (rh - bt) / 2;
    svg.append(s('text', { class: 't-lab', x: m.l - 12, y: y + bt / 2 - 1, 'text-anchor': 'end' }, partyName(g)),
      s('text', { class: 't-axis', x: m.l - 12, y: y + bt / 2 + 14, 'text-anchor': 'end' }, `${fComp(g.reg)} registered`));
    const bar = s('path', { class: 'mark', d: rrect(m.l, y, x(g.rate) - m.l, bt, { tr: 4, br: 4 }), fill: g.color });
    hover(bar, () => tipContent(g.name, [{ color: g.color, label: 'Turnout', value: fPct(g.rate) }, { label: 'Ballots', value: fInt(g.bal) }, { label: 'Registered', value: fInt(g.reg) }, ...(ci != null ? [{ label: 'Florida, same group', value: fPct(PARTY[g.k].rate) }] : [])]));
    svg.append(bar, s('text', { class: 't-val', x: x(g.rate) + 8, y: y + bt / 2 + 4.5 }, fPct(g.rate)));
    if (ci != null) { const fx = crisp(x(PARTY[g.k].rate)); svg.append(s('line', { x1: fx, x2: fx, y1: y - 6, y2: y + bt + 6, stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linecap': 'round' })); }
  });
  const sx = crisp(x(T.rate));
  svg.append(s('line', { class: 'refl', x1: sx, x2: sx, y1: m.t - 6, y2: H - m.b }), s('text', { class: 't-note', x: sx + 6, y: m.t - 10 }, `All voters ${fPct(T.rate)}`));
  if (ci != null) host.append(h('p', { class: 'mini-note', style: { marginTop: '6px' } }, 'The dark tick on each bar is that group’s rate across all of Florida.'));
  api.label(`Turnout rate by party so far in ${scopeLabel()}.`);
}
function partyRateCard() {
  return card({
    id: 'c-prate', kicker: 'Bar chart', cat: 'mochi', stack: true,
    title: () => { const t = byPartyRate()[0]; return `${t.who} lead on turnout${inScope()} so far, at ${fPct(t.rate)}`; },
    sub: 'Share of each group’s registered voters who have already voted.',
    draw: drawPartyRate,
    notes: {
      what: 'A bar chart compares one number across groups. Here the number is a rate: of everyone registered in a group, how many have voted?',
      how: 'Bar length is the group’s turnout rate. The vertical line is the rate for all voters, so bars to its right are above average.',
      shows: () => byPartyRate().map(g => `**${g.name}**: ${fPct(g.rate)}.`).join(' '),
      watch: () => HAS_ED ? 'Party here is how a voter registered. It says nothing about how anyone voted, and these counts keep changing until polls close.' : 'Party here is how a voter registered. It says nothing about how anyone voted, and Election Day has not happened yet.',
      nerd: { title: 'rates vs counts', text: 'Republicans are the biggest group, so they have cast a lot of ballots in total. Democrats are smaller but have voted at a higher rate. Counts answer "how many?" Rates answer "how likely?" and stay fair across groups of different sizes.' },
    },
    table: () => ({ head: ['Party group', 'Registered', 'Ballots', 'Turnout'], align: ['l', 'n', 'n', 'n'], rows: byPartyRate().map(g => [g.name, fInt(g.reg), fInt(g.bal), fPct(g.rate, 2)]) }),
  });
}

/* ---- share of ballots: donut or bars ---- */
function arcPath(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)], big = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0},${y0}A${r1},${r1} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${big} 0 ${x3},${y3}Z`;
}
function drawShare(host, w, api, kind) {
  const rows = [...PS()].sort((a, b) => b.shareBal - a.shareBal), pbal = sum(rows.map(g => g.bal));
  if (kind === 'bars') {
    const rh = 48, bt = 24, m = { l: 138, r: 64, t: 8, b: 30 }, H = m.t + rows.length * rh + m.b, iw = w - m.l - m.r;
    const tk = niceTicks(rows[0].shareBal * 1.1, 4), x = linear(0, tk.max, m.l, m.l + iw), svg = svgBox(w, H); host.append(svg);
    axisX(svg, x, tk.ticks, m.t, H - m.b, v => v + '%', H - m.b + 17);
    svg.append(s('line', { class: 'axisl', x1: crisp(m.l), x2: crisp(m.l), y1: m.t, y2: H - m.b }));
    rows.forEach((g, i) => {
      const y = m.t + i * rh + (rh - bt) / 2;
      svg.append(s('text', { class: 't-lab', x: m.l - 12, y: y + bt / 2 + 4.5, 'text-anchor': 'end' }, partyName(g)));
      const bar = s('path', { class: 'mark', d: rrect(m.l, y, x(g.shareBal) - m.l, bt, { tr: 4, br: 4 }), fill: g.color });
      hover(bar, () => tipContent(g.name, [{ color: g.color, label: 'Share of ballots', value: fPct(g.shareBal) }, { label: 'Ballots', value: fInt(g.bal) }]));
      svg.append(bar, s('text', { class: 't-val', x: x(g.shareBal) + 8, y: y + bt / 2 + 4.5 }, fPct(g.shareBal)));
    });
    api.label('Share of ballots by party, as bars.');
    return;
  }
  const size = Math.min(w, 340), H = size, cx = w / 2, cy = size / 2, r1 = size / 2 - 6, r0 = r1 * .6, gap = .02;
  const svg = svgBox(w, H); host.append(svg);
  let a = 0;
  rows.forEach(g => {
    const span = g.shareBal / 100 * Math.PI * 2, a0 = a + gap / 2, a1 = Math.max(a + span - gap / 2, a0 + .004);
    const arc = s('path', { class: 'mark', d: arcPath(cx, cy, r0, r1, a0, a1), fill: g.color, tabindex: 0, role: 'img', 'aria-label': `${g.name}: ${fPct(g.shareBal)} of ballots` });
    hover(arc, () => tipContent(g.name, [{ color: g.color, label: 'Share of ballots', value: fPct(g.shareBal) }, { label: 'Ballots', value: fInt(g.bal) }]));
    svg.append(arc);
    if (span > .32) { const mid = a + span / 2, rr = (r0 + r1) / 2; svg.append(s('text', { class: 't-in' + labelInk(g.color), x: cx + rr * Math.sin(mid), y: cy - rr * Math.cos(mid) + 4, 'text-anchor': 'middle' }, fPct(g.shareBal, 0))); }
    a += span;
  });
  svg.append(s('text', { x: cx, y: cy + 2, 'text-anchor': 'middle', class: 't-val', style: { fontSize: '30px', fontWeight: 800 } }, fComp(pbal)),
    s('text', { class: 't-axis', x: cx, y: cy + 24, 'text-anchor': 'middle' }, 'ballots with a party'));
  api.label('Share of ballots by party, as a donut.');
}
function shareCard() {
  let kind = 'donut', api;
  const seg = segmented('Chart type', [['donut', 'Donut'], ['bars', 'Bars']], 'donut', v => { kind = v; api.redraw(); });
  api = card({
    id: 'c-share', kicker: 'Donut chart and bar chart', cat: 'pearl', controls: [seg],
    title: () => { const r = partyOf('REP'), d = partyOf('DEM'); return `${r.who} are ${fPct(r.shareBal)} of ballots${inScope()} so far and ${d.who} ${fPct(d.shareBal)}`; },
    sub: 'Who cast the ballots counted so far, by party registration.',
    legend: partyLegend, draw: (host, w, a) => drawShare(host, w, a, kind),
    notes: {
      what: 'A donut chart shows parts of one whole as slices of a ring. It works for a few big pieces ("about 40%, about 38%, about 20%") and falls apart when you need to compare close values.',
      how: 'Each slice is a share of all ballots. Slice size is an angle, which is harder for the eye than a length. Flip to Bars to compare the same numbers.',
      shows: () => { const r = partyOf('REP'), d = partyOf('DEM'), t = sum(PS().map(g => g.bal)); return `Of **${fInt(t)}** ballots${inScope()}, **${fPct(r.shareBal)}** are from Republicans and **${fPct(d.shareBal)}** from Democrats, a gap of **${Math.abs(r.shareBal - d.shareBal).toFixed(1)}** points. In the donut that can look almost identical.`; },
      watch: 'Pie and donut charts are fine for 3 to 5 slices and bad for close calls. Use bars when the difference matters.',
    },
    table: () => ({ head: ['Party group', 'Ballots', 'Share of ballots'], align: ['l', 'n', 'n'], rows: PS().map(g => [g.name, fInt(g.bal), fPct(g.shareBal, 2)]) }),
  });
  return api;
}

/* ---- dumbbell: share of registered voters vs share of ballots ---- */
function drawDumbbell(host, w, api) {
  const rows = [...PS()].sort((a, b) => b.shareReg - a.shareReg);
  const narrow = w < 560;                                  // phones: label and numbers sit above a full-width track
  const rh = narrow ? 72 : 54, m = narrow ? { l: 12, r: 12, t: 6, b: 30 } : { l: 138, r: 124, t: 12, b: 30 }, H = m.t + rows.length * rh + m.b, iw = w - m.l - m.r;
  const tk = niceTicks(Math.max(...rows.map(g => Math.max(g.shareReg, g.shareBal))) * 1.1, 4), x = linear(0, tk.max, m.l, m.l + iw);
  const svg = svgBox(w, H); host.append(svg);
  axisX(svg, x, tk.ticks, m.t, H - m.b, v => v + '%', H - m.b + 17);
  rows.forEach((g, i) => {
    const top = m.t + i * rh, y = narrow ? top + 50 : top + rh / 2, xr = x(g.shareReg), xb = x(g.shareBal), d = g.shareBal - g.shareReg;
    const name = partyName(g), nums = `${fPct(g.shareReg)} → ${fPct(g.shareBal)}`;
    if (narrow) svg.append(s('text', { class: 't-lab', x: m.l, y: top + 16 }, name), s('text', { class: 't-val', x: w - m.r, y: top + 16, 'text-anchor': 'end' }, `${fPts(d)} pts`), s('text', { class: 't-axis', x: m.l, y: top + 33 }, nums));
    else svg.append(s('text', { class: 't-lab', x: m.l - 12, y: y + 4.5, 'text-anchor': 'end' }, name), s('text', { class: 't-val', x: w - 6, y: y - 1, 'text-anchor': 'end' }, `${fPts(d)} pts`), s('text', { class: 't-axis', x: w - 6, y: y + 15, 'text-anchor': 'end' }, nums));
    svg.append(s('line', { x1: xr, x2: xb, y1: y, y2: y, stroke: 'var(--ink-3)', 'stroke-width': 2, 'stroke-linecap': 'round' }),
      s('circle', { cx: xr, cy: y, r: 7, fill: 'var(--surface)', stroke: g.color, 'stroke-width': 3 }), s('circle', { cx: xb, cy: y, r: 7, fill: g.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    const hit = s('rect', { class: 'hit', x: 0, y: top, width: w, height: rh });
    hover(hit, () => tipContent(g.name, [{ label: 'Share of registered voters', value: fPct(g.shareReg) }, { color: g.color, label: 'Share of ballots so far', value: fPct(g.shareBal) }, { label: 'Difference', value: `${fPts(d)} pts` }]));
    svg.append(hit);
  });
  api.label('For each party, its share of registered voters compared with its share of ballots cast.');
}
function dumbbellCard() {
  return card({
    id: 'c-dumb', kicker: 'Dumbbell chart', cat: 'pearl', stack: true,
    title: () => { const g = [...PS()].sort((a, b) => (b.shareBal - b.shareReg) - (a.shareBal - a.shareReg))[0]; return `${g.who} are ${fPct(g.shareReg, 0)} of voters but ${fPct(g.shareBal, 0)} of ballots${inScope()} so far`; },
    sub: 'Each party’s share of registered voters, and its share of the ballots cast.',
    legend: () => [{ type: 'ring', color: 'var(--ink-2)', label: 'Share of registered voters' }, { type: 'dot', color: 'var(--ink-2)', label: 'Share of ballots so far' }],
    draw: drawDumbbell,
    notes: {
      what: 'A dumbbell chart draws two dots joined by a line for each item, so you can see how far each one moves between two measures.',
      how: 'The hollow dot is a group’s share of registered voters. The solid dot is its share of ballots. A long line means over- or under-representation among voters so far.',
      shows: () => { const d = partyOf('DEM'), r = partyOf('REP'), n = partyOf('NPA'), dl = g => fPts(g.shareBal - g.shareReg); return `**Democrats** move **${dl(d)}** points (${fPct(d.shareReg)} of voters to ${fPct(d.shareBal)} of ballots), **Republicans** **${dl(r)}** and **no-party voters** **${dl(n)}**.`; },
      watch: () => HAS_ED ? 'Election Day ballots are still coming in, so these shares can keep moving until polls close.' : 'Ballots so far are early and mail votes only. The mix can shift a lot once Election Day votes arrive.',
      nerd: { title: 'why shares, not counts?', text: 'A share compares each group with the whole. Registered share is the baseline: if every group voted at the same rate, the two dots would sit on top of each other. Distance from the baseline is the story.' },
    },
    table: () => ({ head: ['Party group', 'Share of registered', 'Share of ballots', 'Difference (pts)'], align: ['l', 'n', 'n', 'n'], rows: PS().map(g => [g.name, fPct(g.shareReg, 2), fPct(g.shareBal, 2), fPts(g.shareBal - g.shareReg, 2)]) }),
  });
}

/* ---- how each party voted: 100% stacked bars ---- */
function drawPartyMix(host, w, api) {
  const rows = PS().map(g => { const v = [g.mail, g.early, g.ed]; return { ...g, v, tot: sum(v) }; }).filter(g => g.tot > 0);
  if (!rows.length) { emptyCard(host, 'No ballots recorded for this county yet.'); return; }
  const rh = 44, bt = 24, m = { l: 138, r: 70, t: 4, b: 8 }, H = m.t + rows.length * rh + m.b, iw = w - m.l - m.r, svg = svgBox(w, H); host.append(svg);
  rows.forEach((g, i) => {
    const y = m.t + i * rh + (rh - bt) / 2; let cur = m.l;
    svg.append(s('text', { class: 't-lab', x: m.l - 12, y: y + bt / 2 + 4.5, 'text-anchor': 'end' }, partyName(g)));
    const parts = [['Mail', g.v[0], 'var(--mail)'], ['Early voting', g.v[1], 'var(--early)'], ['Election Day', g.v[2], 'var(--ed)']].filter(p => p[1] > 0);
    parts.forEach(([name, v, col], j) => {
      const wpx = v / g.tot * iw, last = j === parts.length - 1, label = fPct(100 * v / g.tot, 0);
      const seg = s('path', { class: 'mark', d: rrect(cur, y, Math.max(wpx - (last ? 0 : 2), 1), bt, last ? { tr: 4, br: 4 } : {}), fill: col });
      hover(seg, () => tipContent(g.name, [{ color: col, label: name, value: `${fInt(v)}  (${fPct(100 * v / g.tot)})` }, { label: 'All ballots by this group', value: fInt(g.tot) }]));
      svg.append(seg);
      if (wpx > textW(label, 12, 800) + 16) svg.append(s('text', { class: 't-in' + labelInk(col), x: cur + (wpx - (last ? 0 : 2)) / 2, y: y + bt / 2 + 4, 'text-anchor': 'middle' }, label));
      cur += wpx;
    });
    svg.append(s('text', { class: 't-axis', x: w - m.r + 10, y: y + bt / 2 + 4.5 }, fComp(g.tot)));
  });
  api.label('How each party group voted: mail versus early voting, as shares of its own ballots.');
}
function partyMixCard() {
  return card({
    id: 'c-pmix', kicker: '100% stacked bar chart', cat: 'mochi', stack: true,
    title: () => `${partyOf('DEM').who} used mail for ${fPct(mailOf(partyOf('DEM')), 0)} of their ballots${inScope()}; ${partyOf('REP').who} for ${fPct(mailOf(partyOf('REP')), 0)}`,
    sub: () => `For each party group, how its own ballots split between mail and in-person early voting${HAS_ED ? ' and Election Day' : ''}.`,
    legend: typeLegend, draw: drawPartyMix,
    notes: {
      what: 'A 100% stacked bar gives every group a bar of the same length, so you compare the mix inside each group rather than the group sizes.',
      how: () => `Each bar is one group’s ballots. The green slice is mail, the purple slice is early voting${HAS_ED ? ' and the brown slice is Election Day' : ''}. The number at the right is how many ballots the bar stands for.`,
      shows: () => { const ordered = PS().filter(g => g.mail + g.early + g.ed > 0).sort((a, b) => mailOf(b) - mailOf(a)); if (ordered.length < 2) return 'Not enough ballots yet.'; const lo = ordered[ordered.length - 1]; return `**${ordered[0].who}** lean on mail most (**${fPct(mailOf(ordered[0]), 0)}**) and **${lo.who}** least (**${fPct(mailOf(lo), 0)}**). Different groups choose different ways to vote.`; },
      watch: 'Every bar is full length, so small groups look as big as large ones. The number at the right keeps the sizes honest.',
    },
    table: () => ({ head: ['Party group', 'Mail', 'Early voting', ...(HAS_ED ? ['Election Day'] : []), 'Mail share'], align: ['l', 'n', 'n', ...(HAS_ED ? ['n'] : []), 'n'], rows: PS().map(g => [g.name, fInt(g.mail), fInt(g.early), ...(HAS_ED ? [fInt(g.ed)] : []), fPct(mailOf(g))]) }),
  });
}

/* ---- diverging columns: Republican minus Democratic turnout rate, county by county ---- */
function drawGap(host, w, api) {
  const rows = [...C].sort((a, b) => b.gap - a.gap), n = rows.length, H = clamp(Math.round(w * .3), 280, 360), m = { l: 50, r: 10, t: 22, b: 26 };
  const iw = w - m.l - m.r, ih = H - m.t - m.b, lo = rows[n - 1].gap, hi = rows[0].gap;
  const tk = niceTicks(Math.max(hi, -lo) * 1.05, 4, 0), ymin = -Math.ceil(Math.abs(lo) / tk.step) * tk.step, ymax = Math.ceil(hi / tk.step) * tk.step;
  const y = linear(ymin, ymax, m.t + ih, m.t), band = iw / n, bw = clamp(band * .7, 3, 16), svg = svgBox(w, H); host.append(svg);
  for (let v = ymin; v <= ymax + 1e-9; v += tk.step) {
    const yy = crisp(y(v)); svg.append(s('line', { class: v === 0 ? 'axisl' : 'gridl', x1: m.l, x2: w - m.r, y1: yy, y2: yy }), s('text', { class: 't-axis', x: m.l - 8, y: yy + 4, 'text-anchor': 'end' }, v === 0 ? '0' : fPts(v, 0)));
  }
  rows.forEach((c, i) => {
    const xx = m.l + band * (i + .5) - bw / 2, up = c.gap >= 0, y0 = y(0), y1 = y(c.gap), ht = Math.max(Math.abs(y1 - y0), 1);
    const col = up ? 'var(--rep)' : 'var(--dem)', isSel = selection.i === c.i;
    const bar = s('path', { class: 'mark clickable', d: up ? rrect(xx, y1, bw, ht, { tl: 3, tr: 3 }) : rrect(xx, y0, bw, ht, { bl: 3, br: 3 }), fill: col, ...(isSel ? { stroke: 'var(--ink)', 'stroke-width': 2 } : {}) });
    const hit = s('rect', { class: 'hit', x: m.l + i * band, y: m.t, width: band, height: ih, style: { cursor: 'pointer' } });
    hover(hit, () => tipContent(c.name, [{ color: 'var(--rep)', label: 'Republican turnout', value: fPct(c.repRate) }, { color: 'var(--dem)', label: 'Democratic turnout', value: fPct(c.demRate) }, { label: 'Gap (Rep − Dem)', value: `${fPts(c.gap)} pts` }], pickHint));
    hit.addEventListener('click', () => selection.set(c.i));
    svg.append(bar, hit);
  });
  const nR = rows.filter(c => c.gap > 0).length;
  const narrow = w < 600;
  if (selection.i != null) {                                   // call out the selected county's column
    const k = rows.findIndex(c => c.i === selection.i), c = rows[k], bx = m.l + band * (k + .5), up = c.gap >= 0, lab = `${c.name} ${fPts(c.gap)}`, edge = bx < m.l + 70 ? 'start' : bx > w - m.r - 70 ? 'end' : 'middle';
    svg.append(s('text', { class: 't-note', x: bx + (edge === 'start' ? -4 : edge === 'end' ? 4 : 0), y: up ? y(c.gap) - 8 : y(c.gap) + 18, 'text-anchor': edge, style: { fontWeight: 900 } }, lab));
  }
  svg.append(s('text', { class: 't-note', x: m.l, y: 12 }, narrow ? `← Republicans ahead in ${nR}` : `← ${nR} counties where Republicans vote at the higher rate`),
    s('text', { class: 't-note', x: w - m.r, y: H - 4, 'text-anchor': 'end' }, narrow ? `Democrats ahead in ${n - nR} →` : `${n - nR} counties where Democrats do →`));
  api.label('Counties sorted by the Republican minus Democratic turnout rate, shown as diverging columns.');
}
function gapCard() {
  let api;
  api = card({
    id: 'c-gap', kicker: 'Diverging bar chart', cat: 'mochi', stack: true,
    title: () => { if (scopeC()) { const c = scopeC(); return `${c.name}: ${c.gap >= 0 ? 'Republicans' : 'Democrats'} vote at the higher rate, by ${Math.abs(c.gap).toFixed(1)} points`; } return `Democratic turnout rate is ahead of Republican in ${C.filter(c => c.gap < 0).length} of ${N} counties`; },
    sub: () => scopeC() ? `Republican minus Democratic turnout rate for every county, in percentage points. ${scopeName()} is outlined and labeled; it ranks #${[...C].sort((a, b) => b.gap - a.gap).findIndex(c => c.i === scopeCi()) + 1} of ${N} for the Republican side.` : 'Republican minus Democratic turnout rate, in percentage points, one column per county.',
    legend: () => [{ color: 'var(--rep)', label: 'Republicans vote at the higher rate' }, { color: 'var(--dem)', label: 'Democrats vote at the higher rate' }],
    draw: drawGap,
    notes: {
      what: 'A diverging bar chart centers on a baseline, here zero, and sends bars up for one side and down for the other. It is built for "which side, and by how much".',
      how: 'Each column is one county, sorted from the most Republican-ahead to the most Democratic-ahead. Height is the gap in percentage points.',
      shows: () => { const rl = C.filter(c => c.gap > 0), byGap = [...C].sort((a, b) => b.gap - a.gap); return `Republicans lead in **${rl.length}** counties, none with more than **${fComp(Math.max(...rl.map(c => c.reg)))}** registered voters, led by **${byGap[0].name}** (**${fPts(byGap[0].gap)}**). Democrats lead everywhere else, by as much as **${Math.abs(byGap[N - 1].gap).toFixed(1)}** points in **${byGap[N - 1].name}**.`; },
      watch: 'A percentage-point gap is the difference between two percentages (49.8% minus 38.6% is 11.2 points). It is not a percent change. And it measures who has voted so far, not who will win.',
      nerd: { title: 'why is the gap so one-sided?', text: () => HAS_ED ? 'Voters choose different ways to vote (see the mail-versus-early chart above), so who has voted so far can differ from who votes next. A gap today says little about the final result.' : 'Voters choose different ways to vote (see the mail-versus-early chart above), and many wait for Election Day. So a gap in who has voted early says little about the final result.' },
    },
    table: () => ({ head: ['County', 'Republican turnout', 'Democratic turnout', 'Gap (pts)'], align: ['l', 'n', 'n', 'n'], rows: [...C].sort((a, b) => b.gap - a.gap).map(c => [c.name, fPct(c.repRate, 2), fPct(c.demRate, 2), fPts(c.gap, 2)]) }),
  });
  return api;
}
