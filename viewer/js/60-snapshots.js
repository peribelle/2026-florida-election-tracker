/* ---------- the Snapshots view: every saved pull, side by side ----------
   Four kinds of pull are archived (AGENTS.md): turnout runs, results pulls, slow precinct pulls and projection pulls.
   Nothing here edits them; the page only reads what the pipeline saved. */
const RUNS = D.runs || [];
const SNP = { a: {}, b: {}, order: true, kinds: ['turnout', 'results', 'slow', 'proj'], replay: { mode: null, i: 0, timer: 0 }, fcRace: null };
const KIND = {
  turnout: { label: 'Turnout runs', one: 'Turnout run', color: 'var(--c3)' }, results: { label: 'Results pulls', one: 'Results pull', color: 'var(--c2)' },
  slow: { label: 'Slow precinct pulls', one: 'Slow precinct pull', color: 'var(--c4)' }, proj: { label: 'Projection pulls', one: 'Projection pull', color: 'var(--c1)' },
};
const kindCount = k => k === 'turnout' ? RUNS.length : k === 'results' ? RSNAPS.length : k === 'slow' ? (HAS_RESULTS ? RS.slow.length : 0) : PSNAPS.length;
const pullTime = (k, i) => new Date((k === 'turnout' ? RUNS[i] : k === 'results' ? RSNAPS[i] : k === 'slow' ? RS.slow[i] : PSNAPS[i]).t).getTime();
const pullId = (k, i) => (k === 'turnout' ? RUNS[i] : k === 'results' ? RSNAPS[i] : k === 'slow' ? RS.slow[i] : PSNAPS[i]).id;
const pullClock = (k, i) => fmtDayClock(new Date(pullTime(k, i)).toISOString());
const allPulls = () => SNP.kinds.flatMap(k => Array.from({ length: kindCount(k) }, (_, i) => ({ k, i, t: pullTime(k, i), id: pullId(k, i) }))).sort((a, b) => a.t - b.t || a.k.localeCompare(b.k));
const withDetail = () => RUNS.map((r, i) => r.d ? i : -1).filter(i => i >= 0);
function snapDefaults() {
  const wd = withDetail();
  if (SNP.a.turnout == null) { SNP.a.turnout = wd.length > 1 ? wd[0] : wd[0] ?? 0; SNP.b.turnout = wd.length ? wd[wd.length - 1] : Math.max(RUNS.length - 1, 0); }
  if (SNP.a.results == null) { SNP.a.results = RLAST > 0 ? 0 : 0; SNP.b.results = Math.max(RLAST, 0); }
  if (SNP.a.proj == null) { SNP.a.proj = 0; SNP.b.proj = Math.max(PLAST, 0); }
  if (SNP.replay.mode == null) SNP.replay.mode = HAS_RESULTS && RSNAPS.length > 1 ? 'results' : RUNS.length > 1 ? 'turnout' : HAS_PROJ ? 'proj' : 'results';
  SNP.replay.i = Math.min(SNP.replay.i, Math.max(replayLen() - 1, 0));
}
const sameAsPrev = (k, i) => {
  if (i === 0) return false;
  if (k === 'turnout') return RUNS[i].ballots === RUNS[i - 1].ballots && RUNS[i].mail === RUNS[i - 1].mail && RUNS[i].early === RUNS[i - 1].early && RUNS[i].ed === RUNS[i - 1].ed;
  if (k === 'results') { const a = RSNAPS[i], b = RSNAPS[i - 1]; return a.ballots === b.ballots && a.votes === b.votes && a.cr === b.cr && a.enrOk === b.enrOk && a.precRows === b.precRows; }
  if (k === 'proj') return JSON.stringify(PJ.pred[i]) === JSON.stringify(PJ.pred[i - 1]) && PSNAPS[i].called === PSNAPS[i - 1].called;
  return false;
};
function pullFacts(k, i) {                                       // [headline, detail]
  if (k === 'turnout') { const r = RUNS[i]; return [`${fInt(r.ballots)} ballots · ${fPct(r.rate)} turnout`, `mail ${fComp(r.mail)} · early ${fComp(r.early)}${r.ed ? ` · Election Day ${fComp(r.ed)}` : ''}${r.d ? '' : ' · totals only'}`]; }
  if (k === 'results') { const r = RSNAPS[i]; return [r.votes ? `${fInt(r.ballots)} ballots counted · ${r.cv} contests with votes` : 'no votes counted', `${r.cr} counties reporting · county sites ${r.enrOk} · precinct files ${r.precOk} (${fComp(r.precRows)} rows)`]; }
  if (k === 'slow') { const r = RS.slow[i]; return [`${r.ok} of ${r.targeted} counties`, `${fComp(r.rows)} precinct rows`]; }
  const r = PSNAPS[i]; return [`${r.races} races · ${r.called} called`, `${['DDHQ', 'Kalshi', 'Polymarket'].filter((_, j) => r.ok[j]).join(', ') || 'no source'} answered${r.maxDiv != null ? ` · widest gap ${(100 * r.maxDiv).toFixed(1)} pts` : ''}`];
}
const pullNote = (k, i) => (k === 'turnout' ? RUNS[i] : k === 'results' ? RSNAPS[i] : k === 'proj' ? PSNAPS[i] : {}).note || '';
const snapSelect = (label, k, which, onChange) => h('label', null, label, h('select', { class: 'field', onchange: e => { SNP[which][k] = +e.target.value; onChange(); } },
  Array.from({ length: kindCount(k) }, (_, i) => h('option', { value: i, ...(SNP[which][k] === i ? { selected: true } : {}) }, `${pullClock(k, i)} · ${pullId(k, i)}`))));
const deltaText = (a, b, f = fInt) => { const d = b - a; return `${d > 0 ? '+' : d < 0 ? '−' : '±'}${f(Math.abs(d))}`; };
const setPull = (k, which, i) => { SNP[which][k] = i; redrawView('snapshots'); const v = viewCache.snapshots; if (v) v.live.forEach(x => x.run()); };

/* ---------- 1. the timeline ---------- */
function drawTimeline(host, w, api) {
  const items = allPulls();
  if (!items.length) { emptyCard(host, 'No pulls are saved yet.'); return; }
  const lanes = SNP.kinds.filter(k => kindCount(k)), lh = 44, m = { l: Math.min(150, w * .26), r: 18, t: 20, b: 44 }, H = m.t + lanes.length * lh + m.b, iw = w - m.l - m.r;
  const n = items.length, byOrder = SNP.order, t0 = items[0].t, t1 = items[n - 1].t || t0 + 1;
  const px = (it, idx) => byOrder ? m.l + (n < 2 ? iw / 2 : idx / (n - 1) * iw) : m.l + (t1 === t0 ? iw / 2 : (it.t - t0) / (t1 - t0) * iw);
  const svg = svgBox(w, H); host.append(svg);
  lanes.forEach((k, li) => { const y = m.t + li * lh + lh / 2;
    svg.append(s('line', { class: 'gridl', x1: m.l, x2: w - m.r, y1: crisp(y), y2: crisp(y) }), s('text', { class: 't-lab', x: m.l - 12, y: y + 1, 'text-anchor': 'end' }, KIND[k].label), s('text', { class: 't-axis', x: m.l - 12, y: y + 15, 'text-anchor': 'end' }, `${kindCount(k)} saved`)); });
  const want = Math.max(2, Math.floor(iw / 110));                         // time labels along the bottom
  Array.from({ length: Math.min(want, n) }, (_, j) => Math.round(j * (n - 1) / (Math.min(want, n) - 1 || 1))).forEach((idx, j, arr) => {
    const it = items[idx], x = px(it, idx);
    svg.append(s('line', { class: 'gridl', x1: crisp(x), x2: crisp(x), y1: m.t - 6, y2: m.t + lanes.length * lh }), s('text', { class: 't-axis', x, y: H - 22, 'text-anchor': j === 0 ? 'start' : j === arr.length - 1 ? 'end' : 'middle' }, fmtClock(new Date(it.t).toISOString())),
      s('text', { class: 't-axis', x, y: H - 8, 'text-anchor': j === 0 ? 'start' : j === arr.length - 1 ? 'end' : 'middle' }, new Intl.DateTimeFormat('en-US', { ...ET, month: 'short', day: 'numeric' }).format(new Date(it.t))));
  });
  items.forEach((it, idx) => {
    const li = lanes.indexOf(it.k), x = px(it, idx), y = m.t + li * lh + lh / 2, [head] = pullFacts(it.k, it.i), isA = SNP.a[it.k] === it.i, isB = SNP.b[it.k] === it.i, same = sameAsPrev(it.k, it.i);
    const dot = s('circle', { cx: x, cy: y, r: 6.5, fill: KIND[it.k].color, stroke: 'var(--surface)', 'stroke-width': 2, opacity: same ? .55 : 1, class: 'clickable', tabindex: 0, role: 'button', 'aria-label': `${KIND[it.k].one} ${pullClock(it.k, it.i)}. ${head}` });
    const act = (e) => { if (it.k === 'slow') return; setPull(it.k, e.shiftKey ? 'a' : 'b', it.i); };
    hover(dot, () => tipContent(`${KIND[it.k].one} · ${pullClock(it.k, it.i)} ET`, [{ label: 'Run id', value: it.id }, { label: head, value: '' }], [pullFacts(it.k, it.i)[1], same ? 'Same numbers as the pull before it' : null, it.k === 'slow' ? null : 'Click to use as B, shift-click for A'].filter(Boolean)));
    dot.addEventListener('click', act); dot.addEventListener('keydown', e => { if (e.key === 'Enter') act(e); });
    svg.append(dot);
    if (isA || isB) svg.append(s('circle', { cx: x, cy: y, r: 11, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'pointer-events': 'none' }), s('text', { class: 't-note', x, y: y - 15, 'text-anchor': 'middle', style: { fontWeight: 900 } }, isA && isB ? 'A·B' : isA ? 'A' : 'B'));
  });
  api.label(`Timeline of ${n} saved pulls in ${lanes.length} lanes.`);
}
function timelineCard() {
  let api;
  const seg = segmented('Spacing', [[true, 'Evenly, in order'], [false, 'By clock time']], SNP.order, v => { SNP.order = v; api.redraw(); });
  api = card({
    id: 'snap-timeline', kicker: 'Timeline (strip plot)', cat: 'mochi', stack: true, controls: [seg],
    title: () => { const t = allPulls().length; return `${t} pulls are saved: ${SNP.kinds.map(k => `${kindCount(k)} ${KIND[k].label.toLowerCase().replace(' pulls', '').replace(' runs', '')}`).filter((_, j) => kindCount(SNP.kinds[j])).join(', ')}`; },
    sub: 'One lane per kind of pull, one dot per saved pull. A faded dot has the same numbers as the pull before it. Click a dot to use it as B in the comparisons below; shift-click for A.',
    draw: drawTimeline,
    notes: {
      what: 'A timeline of everything the pipeline saved. Each lane is a different data feed with its own schedule, so lanes tick at different rhythms.',
      how: 'Evenly spaced puts the pulls in order with equal gaps, so a cluster of test pulls does not hide the rest. By clock time shows the real gaps. The ringed dots marked A and B are the pulls compared below.',
      shows: () => { const it = allPulls(); return it.length ? `The first pull is **${pullClock(it[0].k, it[0].i)}**, the latest **${pullClock(it[it.length - 1].k, it[it.length - 1].i)}** ET.` : 'Nothing saved yet.'; },
      watch: 'Snapshots are never edited. When two look the same, nothing changed at the source between the pulls, which is normal before polls close.',
    },
    table: () => ({ head: ['Kind', 'Run id', 'When (ET)'], rows: allPulls().map(x => [KIND[x.k].one, x.id, pullClock(x.k, x.i)]) }),
  });
  return api;
}

/* ---------- 2. every pull in a table ---------- */
const pullsState = { key: 't', dir: -1, kind: 'all' };
function drawPulls(host) {
  const rows = allPulls().filter(x => pullsState.kind === 'all' || x.k === pullsState.kind).map(x => ({ ...x, facts: pullFacts(x.k, x.i), same: sameAsPrev(x.k, x.i), note: pullNote(x.k, x.i) }));
  const cols = [
    { k: 'kind', t: 'Kind', get: x => x.k, node: x => h('span', { class: 'spill', style: { background: `color-mix(in oklab, ${KIND[x.k].color} 22%, transparent)` } }, KIND[x.k].one) },
    { k: 't', t: 'When (ET)', get: x => x.t, node: x => h('div', null, h('b', null, pullClock(x.k, x.i)), h('div', { class: 'rb-sub' }, x.id)) },
    { k: 'head', t: 'What it holds', nosort: true, get: () => '', cls: 'wrapcell', node: x => h('div', null, x.facts[0], h('div', { class: 'rb-sub' }, x.facts[1])) },
    { k: 'flag', t: 'Flags', nosort: true, get: () => '', cls: 'hide-sm', node: x => h('span', null, x.same ? h('span', { class: 'spill' }, 'same as previous') : null, x.note ? h('span', { class: 'spill warn', style: { marginLeft: x.same ? '4px' : 0 } }, x.note) : null) },
    { k: 'ab', t: 'Compare', nosort: true, get: () => '', node: x => x.k === 'slow' ? h('span', { class: 'rb-sub' }, '—') : h('span', { style: { whiteSpace: 'nowrap' } }, ...['a', 'b'].map(wh => h('button', { type: 'button', class: 'chipbtn', 'aria-pressed': String(SNP[wh][x.k] === x.i), 'aria-label': `Use ${KIND[x.k].one} ${pullClock(x.k, x.i)} as ${wh.toUpperCase()}`, style: { marginRight: '4px', padding: '3px 10px' }, onclick: e => { e.stopPropagation(); setPull(x.k, wh, x.i); } }, wh.toUpperCase()))) },
  ];
  host.append(kitTable(cols, rows, pullsState, () => drawPulls(clear(host)), { maxH: '480px', minW: '720px', label: 'Every saved pull', empty: 'Nothing matches.' }));
}
function pullsCard() {
  let api;
  const kinds = chipRow([['all', 'All'], ...SNP.kinds.filter(k => kindCount(k)).map(k => [k, KIND[k].label])], pullsState.kind, v => { pullsState.kind = v; api.redraw(); }, 'Kind of pull');
  api = card({
    id: 'snap-table', kicker: 'Table', cat: 'pearl', stack: true, noTable: true, controls: [kinds],
    title: 'Every saved pull, newest first', sub: 'Click a column to sort. Use the A and B buttons to pick the pulls the comparisons below look at.', draw: host => drawPulls(host),
    foot: () => 'Source: runs/INDEX.csv, results/INDEX.csv, results/slow/INDEX.csv and projections/INDEX.csv.',
    notes: { what: 'A table is the right home for an audit trail: one row per pull, in a stable order, with the headline numbers beside it.', how: 'The flags say when a pull matches the one before it or carries a note from the pipeline.', shows: () => `${plural(allPulls().length, 'pull')} across ${SNP.kinds.filter(k => kindCount(k)).length} feeds.`, watch: 'A turnout run can hold only totals (no per-county detail); those cannot be compared county by county.' },
  });
  return api;
}

/* ---------- 3. compare two turnout runs ---------- */
function runTotals(run, ci) {
  if (ci == null || !run.d) return { total: run.ballots, mail: run.mail, early: run.early, ed: run.ed, prov: run.prov, reg: run.elig };
  const o = ci * 4, d = run.d, reg = C[ci].reg;
  return { mail: d[o], early: d[o + 1], ed: d[o + 2], prov: d[o + 3], total: d[o] + d[o + 1] + d[o + 2] + d[o + 3], reg };
}
function drawTurnoutCmp(host, w, api) {
  const A = RUNS[SNP.a.turnout], B = RUNS[SNP.b.turnout]; if (!A || !B) { emptyCard(host, 'Pick two turnout runs.'); return; }
  const ci = scopeCi(), tA = runTotals(A, ci), tB = runTotals(B, ci), detail = A.d && B.d, same = SNP.a.turnout === SNP.b.turnout;
  if (ci != null && !detail) host.append(h('p', { class: 'mini-note', style: { margin: '0 0 8px' } }, `One of these runs kept only statewide totals, so ${scopeName()} cannot be isolated. Showing Florida.`));
  const T = ci != null && !detail ? { a: runTotals(A, null), b: runTotals(B, null) } : { a: tA, b: tB };
  const tile = (l, a, b, dot, f = fInt) => h('div', { class: 'kpi' }, h('div', { class: 'l' }, dot ? h('i', { style: { background: dot } }) : null, l), h('div', { class: 'v', style: { fontSize: '1.5rem' } }, f(b)), h('div', { class: 's' }, same ? 'A and B are the same pull' : `${deltaText(a, b, f)} since A (${f(a)})`));
  host.append(h('div', { class: 'kpis', style: { marginTop: 0, marginBottom: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
    tile('Ballots', T.a.total, T.b.total), tile('By mail', T.a.mail, T.b.mail, 'var(--mail)'), tile('Early voting', T.a.early, T.b.early, 'var(--early)'), tile('Election Day', T.a.ed, T.b.ed, 'var(--ed)'),
    tile('Turnout', 100 * T.a.total / T.a.reg, 100 * T.b.total / T.b.reg, null, v => fPct(v, 2))));
  if (!detail) { host.append(h('p', { class: 'mini-note' }, 'County and party changes need two runs that kept their per-county data.')); api.label('Turnout totals for two runs.'); return; }
  const rows = C.map(c => ({ c, d: runTotals(B, c.i).total - runTotals(A, c.i).total })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const top = rows.slice(0, 12); if (ci != null && !top.some(x => x.c.i === ci)) top.push(rows.find(x => x.c.i === ci));
  host.append(h('p', { class: 'mini-note', style: { margin: '4px 0', fontWeight: 800, color: 'var(--ink-2)' } }, 'Counties that changed most between A and B (ballots)'));
  const bars = h('div'); host.append(bars);
  kitBars(bars, w, top.map(x => ({ label: x.c.name, hi: x.c.i === ci, value: Math.max(x.d, 0), color: 'var(--early)', text: deltaText(0, x.d), click: () => selection.set(x.c.i),
    tip: () => tipContent(x.c.name, [{ label: 'At A', value: fInt(runTotals(A, x.c.i).total) }, { label: 'At B', value: fInt(runTotals(B, x.c.i).total) }, { label: 'Change', value: deltaText(0, x.d) }], 'Click to tailor the page to this county') })), { rowH: 28, barH: 14, rightPad: 90, labelW: Math.min(130, w * .3) });
  if (A.p && B.p) {                                                    // party deltas, in party colors
    const pt = (run, k) => ci == null ? sum(C.map(c => run.p[c.i * 4 + k])) : run.p[ci * 4 + k];
    const prow = [['Republican', 0, 'var(--rep)'], ['Democratic', 1, 'var(--dem)'], ['No party (independent)', 2, 'var(--npa)'], ['Minor parties', 3, 'var(--oth)']].map(([l, k, col]) => ({ label: l, value: Math.max(pt(B, k) - pt(A, k), 0), color: col, text: deltaText(pt(A, k), pt(B, k)), tip: () => tipContent(l, [{ label: 'At A', value: fInt(pt(A, k)) }, { label: 'At B', value: fInt(pt(B, k)) }]) }));
    host.append(h('p', { class: 'mini-note', style: { margin: '14px 0 4px', fontWeight: 800, color: 'var(--ink-2)' } }, `New ballots by party registration${ci != null ? ' in ' + scopeName() : ''}`));
    const pb = h('div'); host.append(pb); kitBars(pb, w, prow, { rowH: 30, barH: 16, rightPad: 90, labelW: Math.min(170, w * .3) });
  }
  api.label(`Change in turnout between two runs${ci != null ? ' for ' + scopeLabel() : ''}.`);
}
function turnoutCmpCard() {
  let api;
  const pick = live(h('div'), () => RUNS.length < 1 ? null : h('div', { class: 'pickers' }, snapSelect('A (earlier)', 'turnout', 'a', () => { api.redraw(); }), snapSelect('B (later)', 'turnout', 'b', () => { api.redraw(); })));
  api = card({
    id: 'snap-turnout', kicker: 'Before and after', cat: 'mochi', stack: true, controls: [pick],
    title: () => { const A = RUNS[SNP.a.turnout], B = RUNS[SNP.b.turnout]; return A && B && A !== B ? `${deltaText(runTotals(A, scopeCi()).total, runTotals(B, scopeCi()).total)} ballots between A and B${scopeC() ? ' in ' + scopeName() : ''}` : 'Compare two turnout runs'; },
    sub: () => `Turnout run A (${RUNS[SNP.a.turnout] ? pullClock('turnout', SNP.a.turnout) : '—'}) against B (${RUNS[SNP.b.turnout] ? pullClock('turnout', SNP.b.turnout) : '—'}).`,
    draw: drawTurnoutCmp,
    notes: {
      what: 'Every turnout pull is archived, so any two can be laid next to each other. The numbers are the same feeds as the Turnout view, frozen at the moment of each pull.',
      how: 'The tiles show the later run with the change since the earlier one. Bars show which counties added the most ballots, then how the new ballots split by party registration (red, blue, yellow, gray).',
      shows: () => { const A = RUNS[SNP.a.turnout], B = RUNS[SNP.b.turnout]; if (!A || !B || A === B) return 'Choose two different runs to see change.'; const a = runTotals(A, scopeCi()), b = runTotals(B, scopeCi()); return `Turnout moved from **${fPct(100 * a.total / a.reg, 2)}** to **${fPct(100 * b.total / b.reg, 2)}**, with **${fInt(b.total - a.total)}** new ballots.`; },
      watch: 'Counties refresh on their own clocks, so a county can look flat between two pulls because its feed had not updated yet.',
    },
    table: () => { const A = RUNS[SNP.a.turnout], B = RUNS[SNP.b.turnout]; if (!A || !B || !A.d || !B.d) return { head: ['County'], rows: [] }; return { head: ['County', 'Ballots at A', 'Ballots at B', 'Change'], align: ['l', 'n', 'n', 'n'], rows: C.map(c => [c.name, fInt(runTotals(A, c.i).total), fInt(runTotals(B, c.i).total), deltaText(runTotals(A, c.i).total, runTotals(B, c.i).total)]) }; },
  });
  return api;
}

/* ---------- 4. compare two results pulls ---------- */
function resultsDiffRows() {
  const a = SNP.a.results, b = SNP.b.results, ci = scopeCi(), rows = [];
  for (const r of RACES) {
    const at = ci != null && r.rowIdx.has(ci) ? ci : -1, A = raceSum(r, at, a), B = raceSum(r, at, b); if (!A || !B) continue;
    const dv = B.total - A.total, flip = A.total && B.total && A.lead >= 0 && B.lead >= 0 && A.lead !== B.lead; if (!dv && !flip) continue;
    rows.push({ r, at, A, B, dv, flip, dm: B.marginPct - A.marginPct });
  }
  return rows;
}
const resDiffState = { key: 'flip', dir: -1 };
function drawResultsCmp(host, w, api) {
  const a = SNP.a.results, b = SNP.b.results; if (!HAS_RESULTS) { emptyCard(host, 'No results pulls yet.'); return; }
  const same = a === b, sa = stateReporting(a), sb = stateReporting(b), SA = RSNAPS[a], SB = RSNAPS[b];
  const tile = (l, x, y, f = fInt) => h('div', { class: 'kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v', style: { fontSize: '1.5rem' } }, f(y)), h('div', { class: 's' }, same ? 'A and B are the same pull' : `${deltaText(x, y, f)} since A (${f(x)})`));
  host.append(h('div', { class: 'kpis', style: { marginTop: 0, marginBottom: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
    tile('Ballots counted', sa.ballots, sb.ballots), tile('Counties reporting', sa.counties, sb.counties), tile('Precincts reporting', sa.precinctPct, sb.precinctPct, v => fPct(v, 0)), tile('Contests with votes', SA.cv, SB.cv),
    tile('County sites reachable', SA.enrOk, SB.enrOk), tile('Precinct files', SA.precOk, SB.precOk)));
  const rows = resultsDiffRows();
  if (!anyResults(a) && !anyResults(b)) {
    host.append(h('div', { class: 'callout' }, h('b', null, 'No votes in either pull. '), 'Both snapshots were taken before any votes were counted, so there are no race changes to show. What did change is the pipeline’s coverage: ', rich(`**${SB.enrOk - SA.enrOk >= 0 ? '+' : '−'}${Math.abs(SB.enrOk - SA.enrOk)}** county sites, **${deltaText(SA.precOk, SB.precOk)}** precinct files and **${deltaText(SA.precRows, SB.precRows)}** precinct rows.`)));
    api.label('No votes counted in either results pull.'); return;
  }
  const flips = rows.filter(x => x.flip).length;
  host.append(h('p', { class: 'mini-note', style: { margin: '4px 0 8px' } }, rich(`**${rows.length}** races changed between A and B${scopeC() ? ` (using ${scopeName()}’s numbers where the race includes it)` : ''}. **${flips}** changed leader.`)));
  const cols = [
    { k: 'flip', t: 'Race', get: x => (x.flip ? 1e6 : 0) + Math.abs(x.dm), cls: 'wrapcell namecell', node: x => h('div', null, h('div', { class: 'rb-name' }, x.r.name), x.flip ? h('span', { class: 'spill warn' }, 'Leader changed') : h('div', { class: 'rb-sub' }, x.at === -1 ? 'statewide' : scopeName())) },
    { k: 'dv', t: 'New votes', n: true, get: x => x.dv, fmt: v => v ? deltaText(0, v) : '—' },
    { k: 'la', t: 'Leader at A', get: x => x.A.lead, node: x => x.A.total && x.A.lead >= 0 ? h('span', { style: { whiteSpace: 'nowrap' } }, partyChip(x.r.cands[x.A.lead][1]), ' ', candShort(x.r.cands[x.A.lead]), ' ', h('b', null, fPct(x.A.shares[x.A.lead], 0))) : '—' },
    { k: 'lb', t: 'Leader at B', get: x => x.B.lead, node: x => x.B.total && x.B.lead >= 0 ? h('span', { style: { whiteSpace: 'nowrap' } }, partyChip(x.r.cands[x.B.lead][1]), ' ', candShort(x.r.cands[x.B.lead]), ' ', h('b', null, fPct(x.B.shares[x.B.lead], 0))) : '—' },
    { k: 'dm', t: 'Margin change (pts)', n: true, get: x => x.dm, fmt: v => fPts(v) },
  ];
  host.append(kitTable(cols, rows.slice(0, 400), resDiffState, () => drawResultsCmp(clear(host), w, api), { maxH: '420px', minW: '640px', label: 'Races that changed between two pulls', onRow: x => { RES.key = x.r.id; if (viewCache.results) viewCache.results.stale = true; api.redraw(); } }));
  api.label(`Races that changed between two results pulls.`);
}
function resultsCmpCard() {
  let api;
  const pick = live(h('div'), () => !HAS_RESULTS ? null : h('div', { class: 'pickers' }, snapSelect('A (earlier)', 'results', 'a', () => api.redraw()), snapSelect('B (later)', 'results', 'b', () => api.redraw())));
  api = card({
    id: 'snap-results', kicker: 'Before and after', cat: 'pearl', stack: true, noTable: true, controls: [pick],
    title: () => { if (!HAS_RESULTS) return 'Compare two results pulls'; const rows = resultsDiffRows(); return anyResults(SNP.a.results) || anyResults(SNP.b.results) ? `${plural(rows.length, 'race')} changed between A and B, ${rows.filter(x => x.flip).length} with a new leader` : 'Neither pull has votes yet'; },
    sub: () => HAS_RESULTS ? `Results pull A (${pullClock('results', SNP.a.results)}) against B (${pullClock('results', SNP.b.results)}). Click a race to chart what moved it.` : '',
    draw: (host, w) => drawResultsCmp(host, w, api),
    notes: {
      what: 'This compares two saved snapshots of the count. It answers "what changed between these two moments?" for every race at once.',
      how: 'The tiles show the later pull with its change. In the table, "Leader changed" flags races where the top candidate is different at B. Margin change is in points of share; positive means the leader gained.',
      shows: () => { if (!HAS_RESULTS) return ''; const rows = resultsDiffRows().sort((x, y) => Math.abs(y.dm) - Math.abs(x.dm)); return rows.length ? `Biggest swing: **${rows[0].r.name}** (**${fPts(rows[0].dm)}** points).` : 'Nothing changed between these pulls.'; },
      watch: 'A flip early on can be an artifact of which precincts reported first. Compare pulls that are far apart before reading a trend.',
    },
  });
  return api;
}
/* what moved one race's margin, county by county */
function drawMarginMovers(host, w, api) {
  const r = (RES.key && RES.key[0] !== 'L' ? RACE_BY_ID.get(RES.key) : null) || RACE_BY_ID.get('160000') || RACES[0]; if (!r) return;
  const a = SNP.a.results, b = SNP.b.results, stB = raceSum(r, -1, b);
  if (!stB || !stB.total || stB.order.length < 2) { emptyCard(host, 'The later pull has no votes in this race yet. Pick a later B pull or another race.'); api.label('No data yet.'); return; }
  const lead = stB.order[0], sec = stB.order[1], gain = (ci, s) => { const v = raceVotes(r, ci, s); return v ? v[lead] - v[sec] : 0; };
  const rows = r.rows.filter(c => c >= 0).map(c => ({ c, d: gain(c, b) - gain(c, a) })).filter(x => x.d !== 0).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  if (!rows.length) { emptyCard(host, 'The lead did not move between these pulls.'); api.label('No change.'); return; }
  const top = rows.slice(0, 12), ci = scopeCi(); if (ci != null && !top.some(x => x.c === ci) && rows.some(x => x.c === ci)) top.push(rows.find(x => x.c === ci));
  kitBars(host, w, top.map(x => ({ label: C[x.c].name, hi: x.c === ci, value: x.d, color: x.d >= 0 ? candColor(r.cands, lead) : candColor(r.cands, sec), text: deltaText(0, x.d), click: () => selection.set(x.c),
    tip: () => tipContent(C[x.c].name, [{ color: candColor(r.cands, lead), label: `${candShort(r.cands[lead])} lead over ${candShort(r.cands[sec])} at A`, value: fInt(gain(x.c, a)) }, { label: 'At B', value: fInt(gain(x.c, b)) }, { label: 'Change', value: deltaText(0, x.d) }]) })), { rowH: 28, barH: 14, rightPad: 90, labelW: Math.min(130, w * .3), fmt: v => deltaText(0, v) });
  api.label(`Counties that moved ${r.name}’s margin the most between two pulls.`);
}
function marginMoversCard() {
  let api;
  const pick = selectOf('Race', RACES.map(r => [r.id, r.name]), (RES.key && RES.key[0] !== 'L' ? RES.key : '160000'), v => { RES.key = v; if (viewCache.results) viewCache.results.stale = true; api.redraw(); }, '');
  api = card({
    id: 'snap-movers', kicker: 'Diverging bar chart', cat: 'mochi', stack: true, controls: [pick],
    title: () => { const r = (RES.key && RES.key[0] !== 'L' ? RACE_BY_ID.get(RES.key) : null) || RACE_BY_ID.get('160000'); return r ? `Which counties moved the ${r.name} margin between A and B?` : 'What moved the margin'; },
    sub: 'Change in the leader’s lead over second place, in votes, by county. Bars take the color of whoever gained.',
    draw: drawMarginMovers,
    notes: { what: 'A margin changes when new batches of votes land. This splits that change by county, so you can see where the movement came from.', how: 'Each bar is the change in (leader’s votes minus runner-up’s votes) between A and B. Bars extending right favor the current leader; a bar in the other color favors the runner-up.', shows: () => 'Large bars are big counties reporting big batches.', watch: 'Votes added in a county are not the same as a county changing its mind. Most movement is just more of the same county being counted.' },
    table: () => ({ head: ['County'], rows: [] }),
  });
  return api;
}

/* ---------- 5. compare two projection pulls ---------- */
function projDiffRows() {
  const a = SNP.a.proj, b = SNP.b.proj, rows = [];
  PJR.forEach(R => {
    const pa = pjProbs(R.i, a), pb = pjProbs(R.i, b), fb = pjFavorite(R.i, b), ca = pjCall(R.i, a), cb = pjCall(R.i, b); if (!fb) return;
    const per = [0, 1, 2].map(src => pa[src][fb.side] != null && pb[src][fb.side] != null ? 100 * (pb[src][fb.side] - pa[src][fb.side]) : null);
    const big = Math.max(0, ...per.filter(v => v != null).map(Math.abs)), newCall = !ca && cb;
    if (big < .05 && !newCall) return;
    rows.push({ R, fb, per, big, newCall, cb, pa, pb });
  });
  return rows;
}
const projDiffState = { key: 'big', dir: -1 };
function drawProjCmp(host, w, api) {
  const a = SNP.a.proj, b = SNP.b.proj; if (!HAS_PROJ) { emptyCard(host, 'No projection pulls yet.'); return; }
  const rows = projDiffRows(), SA = PSNAPS[a], SB = PSNAPS[b], same = a === b;
  host.append(h('div', { class: 'kpis', style: { marginTop: 0, marginBottom: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
    kpiTile('Races with a forecast', String(SB.races), same ? 'same pull' : `${deltaText(SA.races, SB.races)} since A`), kpiTile('Races called', String(SB.called ? new Set((PJ.calls[b] || []).map(c => c[0])).size : 0), same ? 'same pull' : `${deltaText(new Set((PJ.calls[a] || []).map(c => c[0])).size, new Set((PJ.calls[b] || []).map(c => c[0])).size)} since A`),
    kpiTile('Widest source gap', SB.maxDiv != null ? `${(100 * SB.maxDiv).toFixed(1)} pts` : '—', SA.maxDiv != null && !same ? `was ${(100 * SA.maxDiv).toFixed(1)} pts` : ''), kpiTile('Sources that answered', `${SB.ok.reduce((x, y) => x + y, 0)} of 3`, SB.ok[0] ? 'DDHQ ' + (SB.ok[1] ? '· Kalshi ' : '') + (SB.ok[2] ? '· Polymarket' : '') : 'DDHQ failed')));
  if (!rows.length) { host.append(h('div', { class: 'callout' }, same ? 'A and B are the same pull.' : h('span', null, h('b', null, 'No probability moved. '), 'The odds and race calls are identical in these two pulls.'))); api.label('No change between the two projection pulls.'); return; }
  const cols = [
    { k: 'name', t: 'Race', get: x => x.R.name, cls: 'wrapcell namecell', node: x => h('div', null, h('div', { class: 'rb-name' }, x.R.name), x.newCall ? h('span', { class: 'spill ok' }, `Called for ${pjSurname(x.cb.name)}`) : h('div', { class: 'rb-sub' }, x.R.office)) },
    { k: 'fav', t: 'Favorite at B', get: x => x.fb.p, node: x => h('span', { style: { whiteSpace: 'nowrap' } }, partyChip(x.fb.sideObj.p), ' ', sideName(x.fb.sideObj), ' ', h('b', null, fProb(x.fb.p))) },
    ...[0, 1, 2].map(src => ({ k: 's' + src, t: `${PSRC_SHORT[src]} change`, n: true, get: x => x.per[src] ?? -1e9, fmt: v => v > -1e8 ? `${fPts(v)} pts` : '—' })),
    { k: 'big', t: 'Largest move', n: true, get: x => x.big, fmt: v => `${v.toFixed(1)} pts` },
  ];
  host.append(kitTable(cols, rows, projDiffState, () => drawProjCmp(clear(host), w, api), { maxH: '420px', minW: '700px', label: 'Forecast changes between two pulls', onRow: x => { if (x.R.rid) go('results', { race: x.R.rid, s: 'r-forecast' }); } }));
  api.label('Forecast changes between two projection pulls.');
}
function projCmpCard() {
  let api;
  const pick = live(h('div'), () => !HAS_PROJ ? null : h('div', { class: 'pickers' }, snapSelect('A (earlier)', 'proj', 'a', () => api.redraw()), snapSelect('B (later)', 'proj', 'b', () => api.redraw())));
  api = card({
    id: 'snap-proj', kicker: 'Before and after', cat: 'mochi', stack: true, noTable: true, controls: [pick],
    title: () => { if (!HAS_PROJ) return 'Compare two projection pulls'; const rows = projDiffRows(); return rows.length ? `${plural(rows.length, 'forecast')} moved between A and B` : 'The forecasts did not move between A and B'; },
    sub: () => HAS_PROJ ? `Projection pull A (${pullClock('proj', SNP.a.proj)}) against B (${pullClock('proj', SNP.b.proj)}). Changes are for each race’s favorite at B, in points of win probability.` : '',
    draw: (host, w) => drawProjCmp(host, w, api),
    notes: { what: 'Forecasts and market prices move through the night as evidence arrives. This lays two saved pulls side by side and lists what shifted.', how: 'Each source gets its own change column. A race called by DDHQ between A and B is flagged. Click a row to open its forecast.', shows: () => { if (!HAS_PROJ) return ''; const rows = projDiffRows().sort((x, y) => y.big - x.big); return rows.length ? `Biggest move: **${rows[0].R.name}** (**${rows[0].big.toFixed(1)}** points).` : 'No change.'; }, watch: 'These are predictions. A forecast moving toward a candidate is not a vote count.' },
  });
  return api;
}

/* ---------- 6. replay ---------- */
const REPLAY_MODES = () => [...(HAS_RESULTS && RSNAPS.length > 1 ? [['results', 'Results']] : []), ...(RUNS.length > 1 ? [['turnout', 'Turnout']] : []), ...(HAS_PROJ && PSNAPS.length > 1 ? [['proj', 'Forecasts']] : [])];
const replayLen = () => SNP.replay.mode === 'results' ? RSNAPS.length : SNP.replay.mode === 'turnout' ? RUNS.length : SNP.replay.mode === 'proj' ? PSNAPS.length : 1;
const replayKind = () => SNP.replay.mode === 'results' ? 'results' : SNP.replay.mode === 'turnout' ? 'turnout' : 'proj';
function drawReplay(host, w, api) {
  const i = SNP.replay.i, mode = SNP.replay.mode, ci = scopeCi();
  host.append(h('p', { class: 'mini-note', style: { margin: '0 0 8px', fontWeight: 800, color: 'var(--ink-2)' } }, `${pullClock(replayKind(), i)} ET · pull ${i + 1} of ${replayLen()}`));
  const box = h('div'); host.append(box);
  if (mode === 'results') {
    const r = (RES.key && RES.key[0] !== 'L' ? RACE_BY_ID.get(RES.key) : null) || RACE_BY_ID.get('160000') || RACES[0], at = ci != null && r.rowIdx.has(ci) ? ci : -1, sm = raceSum(r, at, i), rep = stateReporting(i);
    box.append(h('div', { class: 'kpis', style: { marginTop: 0, marginBottom: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } }, kpiTile('Ballots counted', fInt(rep.ballots), 'statewide'), kpiTile('Precincts reporting', fPct(rep.precinctPct, 0), `${rep.counties} counties with ballots`), kpiTile(r.name, sm && sm.total ? fInt(sm.total) : '0', `votes in ${at === -1 ? 'Florida' : scopeName()}`)));
    if (!sm || !sm.total) { box.append(h('p', { class: 'mini-note' }, 'No votes are counted in this race at this pull.')); return; }
    kitBars(box, w, sm.order.slice(0, 6).map(k => ({ label: candShort(r.cands[k]), sub: r.cands[k][1] || 'No party', value: sm.v[k], color: candColor(r.cands, k), hi: sm.lead === k, text: `${fInt(sm.v[k])} · ${fPct(sm.shares[k])}` })), { rowH: 40, rightPad: 140, axis: false, labelW: Math.min(200, w * .34), max: Math.max(...RSNAPS.map((_, s) => { const x = raceSum(r, at, s); return x ? Math.max(...x.v) : 0; }), 1) });
  } else if (mode === 'turnout') {
    const run = RUNS[i], T = runTotals(run, ci), partial = ci != null && !run.d;
    if (partial) box.append(h('p', { class: 'mini-note' }, 'This run kept only statewide totals; showing Florida.'));
    const U = partial ? runTotals(run, null) : T;
    kitStack(box, w, [{ label: partial || ci == null ? 'Florida' : scopeName(), sub: `${fInt(U.total)} ballots`, parts: [{ label: 'Mail', color: 'var(--mail)', value: U.mail }, { label: 'Early voting', color: 'var(--early)', value: U.early }, ...(U.ed ? [{ label: 'Election Day', color: 'var(--ed)', value: U.ed }] : [])], text: fPct(100 * U.total / U.reg, 1) }], { mode: 'count', rowH: 56, barH: 28, rightPad: 90, labelW: Math.min(150, w * .3) });
  } else {
    const R = SNP.fcRace != null ? PJR[SNP.fcRace] : (PJR.find(x => x.key === 'FL-GOV') || PJR[0]), pr = pjProbs(R.i, i), call = pjCall(R.i, i);
    box.append(h('p', { class: 'mini-note', style: { margin: '0 0 6px' } }, call ? `DDHQ had called ${R.name} for ${pjSurname(call.name)} by this pull.` : `${R.name} was not called at this pull.`));
    kitStack(box, w, pjSources(R.i, i).map(({ src, arr }) => ({ label: PSRC_NAME[src], parts: R.sides.map((sd, k) => arr[k] == null ? null : { label: sideName(sd), color: pjSideColor(sd), value: arr[k] }).filter(Boolean), text: '' })), { mode: 'share', fixed: 1, rowH: 48, barH: 24, rightPad: 20, labelW: Math.min(170, w * .3), fmtPart: p => fProb(p.value) });
  }
  api.label(`Replay of pull ${i + 1} of ${replayLen()}.`);
}
function stopReplay() { if (SNP.replay.timer) { clearInterval(SNP.replay.timer); SNP.replay.timer = 0; } }
function replayCard() {
  let api, scrub, play, status;
  const modes = live(h('div'), () => { const m = REPLAY_MODES(); return m.length > 1 ? chipRow(m, SNP.replay.mode, v => { stopReplay(); SNP.replay.mode = v; SNP.replay.i = 0; sync(); api.redraw(); }, 'What to replay') : null; });
  const raceSel = live(h('div'), () => { const m = SNP.replay.mode; if (m === 'results') return selectOf('Race', RACES.map(r => [r.id, r.name]), (RES.key && RES.key[0] !== 'L' ? RES.key : '160000'), v => { RES.key = v; if (viewCache.results) viewCache.results.stale = true; api.redraw(); }); if (m === 'proj') return selectOf('Race', PJR.map(R => [R.i, R.name]), SNP.fcRace ?? (PJR.find(x => x.key === 'FL-GOV') || PJR[0]).i, v => { SNP.fcRace = +v; api.redraw(); }); return null; });
  scrub = h('input', { type: 'range', class: 'scrub', min: 0, max: 0, step: 1, value: 0, 'aria-label': 'Move through the saved pulls', oninput: e => { stopReplay(); SNP.replay.i = +e.target.value; sync(); api.redraw(); } });
  play = h('button', { type: 'button', class: 'btn', onclick: () => {
    if (SNP.replay.timer) { stopReplay(); sync(); return; }
    if (SNP.replay.i >= replayLen() - 1) SNP.replay.i = 0;
    SNP.replay.timer = setInterval(() => { if (!document.body.contains(scrub)) { stopReplay(); return; } if (SNP.replay.i >= replayLen() - 1) { stopReplay(); sync(); return; } SNP.replay.i++; sync(); api.redraw(); }, 800);
    sync(); api.redraw();
  } }, 'Play');
  status = h('span', { class: 'mini-note' });
  const sync = () => { scrub.max = Math.max(replayLen() - 1, 0); scrub.value = SNP.replay.i; play.textContent = SNP.replay.timer ? 'Pause' : 'Play'; play.setAttribute('aria-pressed', String(!!SNP.replay.timer)); status.textContent = `${SNP.replay.i + 1} / ${replayLen()}`; };
  api = card({
    id: 'snap-replay', kicker: 'Replay (animated bars)', cat: 'pearl', stack: true, controls: [modes, raceSel, h('div', { class: 'scrubbar', style: { width: '100%' } }, play, scrub, status)],
    title: () => SNP.replay.mode === 'results' ? 'Replay the count, pull by pull' : SNP.replay.mode === 'turnout' ? 'Replay the turnout runs' : 'Replay the forecasts',
    sub: 'Drag the slider or press Play to step through the saved pulls in order. Everything on the card is that moment’s numbers.',
    draw: (host, w, a) => { sync(); drawReplay(host, w, a); },
    notes: { what: 'A replay shows how a number moved by showing the same chart at each saved moment, one after another.', how: 'Drag the slider to scrub, or press Play for an animation. The bar scale stays fixed across pulls, so a growing bar means growing votes, not a rescaled chart.', shows: () => `${replayLen()} pulls in this series.`, watch: 'Saved pulls are snapshots, not a continuous feed. Anything that happened between two pulls is invisible here.' },
    table: () => ({ head: ['Pull', 'When (ET)'], rows: Array.from({ length: replayLen() }, (_, i) => [String(i + 1), pullClock(replayKind(), i)]) }),
  });
  return api;
}

/* ---------- 7. pipeline health: coverage and freshness ---------- */
function drawCoverage(host, w, api) {
  if (!HAS_RESULTS) { emptyCard(host, 'No results pulls yet.'); return; }
  const xs = RSNAPS.map(x => new Date(x.t).getTime());
  kitLines(host, w, xs, [{ name: 'County sites', color: 'var(--c2)', ys: RSNAPS.map(x => x.enrOk) }, { name: 'Precinct files', color: 'var(--c3)', ys: RSNAPS.map(x => x.precOk) }, { name: 'Counties reporting', color: 'var(--c4)', ys: RSNAPS.map(x => x.cr) }],
    { yMax: 67, yMin: 0, yFmt: v => String(v), endFmt: v => String(v), xFmt: (m, i) => fmtClock(RSNAPS[i].t), tipHead: i => `${snapLabel(i)} ET`, height: 240, ref: { y: 67, label: 'All 67 counties' } });
  if (RS.slow.length) {
    host.append(h('p', { class: 'mini-note', style: { margin: '14px 0 4px', fontWeight: 800, color: 'var(--ink-2)' } }, 'Slow precinct pulls: counties that worked, out of those attempted'));
    const b = h('div'); host.append(b);
    kitBars(b, w, RS.slow.map(x => ({ label: fmtClock(x.t), sub: x.rows ? `${fComp(x.rows)} rows` : '', value: x.ok, color: x.ok >= x.targeted && x.targeted ? 'var(--mail)' : 'var(--c2)', text: `${x.ok} of ${x.targeted}`, tip: () => tipContent(fmtDayClock(x.t) + ' ET', [{ label: 'Counties that worked', value: `${x.ok} of ${x.targeted}` }, { label: 'Precinct rows', value: fInt(x.rows) }]) })), { rowH: 30, barH: 14, rightPad: 90, max: Math.max(...RS.slow.map(x => x.targeted), 1), labelW: Math.min(150, w * .28) });
  }
  api.label('How many counties each part of the results pipeline reached over time.');
}
function coverageCard() {
  return card({
    id: 'snap-coverage', kicker: 'Line chart', cat: 'mochi', stack: true,
    title: () => { const l = HAS_RESULTS ? RSNAPS[RLAST] : null; return l ? `The latest pull reached ${l.enrOk} county sites, ${l.precOk} precinct files and ${l.cr} reporting counties` : 'Pipeline coverage'; },
    sub: 'What each part of the results pipeline could read, at every saved results pull. Out of 67 counties.',
    legend: () => [{ color: 'var(--c2)', label: 'County sites' }, { color: 'var(--c3)', label: 'Precinct files' }, { color: 'var(--c4)', label: 'Counties reporting' }],
    draw: drawCoverage,
    notes: { what: 'Not every county publishes the same things. This chart tracks how many counties the pipeline could actually read, pull by pull.', how: 'Each line counts counties. "County sites" are counties whose own election page was reachable; "precinct files" are those with a precinct-level download.', shows: () => { const l = HAS_RESULTS ? RSNAPS[RLAST] : null; return l ? `At the latest pull: **${l.enrOk}** of 67 county sites, **${l.precOk}** precinct files, and **${fComp(l.precRows)}** precinct rows.` : ''; }, watch: 'A county missing here is a gap in the data, not a county with nothing to report.' },
    table: () => ({ head: ['Pull', 'County sites', 'Precinct files', 'Precinct rows', 'Counties reporting'], align: ['l', 'n', 'n', 'n', 'n'], rows: HAS_RESULTS ? RSNAPS.map((x, i) => [snapLabel(i), fInt(x.enrOk), fInt(x.precOk), fInt(x.precRows), fInt(x.cr)]) : [] }),
  });
}
function drawFresh(host, w, api) {
  const rows = RUNS.filter(r => r.feed).map((r, i) => ({ r, lag: (new Date(r.t) - new Date(r.feed)) / 6e4 }));
  if (!rows.length) { emptyCard(host, 'No turnout run recorded a feed time.'); return; }
  kitBars(host, w, rows.map(x => ({ label: fmtClock(x.r.t), sub: fmtDayClock(x.r.t).split(',')[0], value: Math.max(x.lag, 0), color: x.lag > 60 ? 'var(--c2)' : 'var(--early)', text: x.lag < 90 ? `${Math.round(x.lag)} min` : `${(x.lag / 60).toFixed(1)} h`,
    tip: () => tipContent(`${fmtDayClock(x.r.t)} ET`, [{ label: 'County feeds last updated', value: fmtDayClock(x.r.feed) + ' ET' }, { label: 'Age at the pull', value: `${Math.round(x.lag)} minutes` }]) })), { rowH: 32, barH: 14, rightPad: 90, labelW: Math.min(120, w * .26), fmt: v => `${Math.round(v)} min` });
  api.label('How old the county feeds were at each turnout pull.');
}
function freshCard() {
  return card({
    id: 'snap-fresh', kicker: 'Bar chart', cat: 'pearl', stack: true,
    title: 'How fresh were the county feeds at each turnout pull?', sub: 'Minutes between the newest county feed timestamp and the moment the pull ran.', draw: drawFresh,
    foot: () => `The oldest county feed in the latest pull was last updated ${stampET(D.meta.feedOldest)}; the newest ${stampET(D.meta.feedLatest)}.`,
    notes: { what: 'A data pull is only as fresh as the feed behind it. This measures how stale the newest feed was when each pull ran.', how: 'Shorter bars are fresher. Bars in the second color mean the feed was more than an hour old.', shows: () => { const rows = RUNS.filter(r => r.feed).map(r => (new Date(r.t) - new Date(r.feed)) / 6e4); return rows.length ? `Median age at pull: **${Math.round(median(rows))}** minutes.` : ''; }, watch: 'The county widgets switch off at poll close, so the last turnout pull before 7 PM is the last one.' },
    table: () => ({ head: ['Pull', 'Feed time', 'Age (minutes)'], align: ['l', 'l', 'n'], rows: RUNS.filter(r => r.feed).map(r => [fmtDayClock(r.t), fmtDayClock(r.feed), String(Math.round((new Date(r.t) - new Date(r.feed)) / 6e4))]) }),
  });
}

/* ---------- the view ---------- */
VIEWS.snapshots = {
  build() {
    snapDefaults();
    const have = k => kindCount(k) > 0;
    const CH = [
      { id: 'sn-line', nav: 'Timeline', title: 'Everything the pipeline saved', lead: () => `Turnout, results, precinct and projection pulls, side by side on one clock. ${anyResults() ? '' : 'No votes are counted yet, so the results pulls are all zeros.'}`, cards: () => [timelineCard().el, pullsCard().el] },
      { id: 'sn-cmp', nav: 'Compare two', title: 'Compare any two pulls', lead: 'Pick an A and a B. Choosing a county in the menu narrows the turnout and results comparisons to it.',
        cards: () => [...(RUNS.length ? [turnoutCmpCard().el] : []), ...(HAS_RESULTS ? [resultsCmpCard().el, marginMoversCard().el] : []), ...(HAS_PROJ ? [projCmpCard().el] : [])] },
      ...(REPLAY_MODES().length ? [{ id: 'sn-replay', nav: 'Replay', title: 'Replay the night', lead: 'Step through the saved pulls like frames of a film.', cards: () => [replayCard().el] }] : []),
      { id: 'sn-health', nav: 'Pipeline health', title: 'How well did the pipeline see?', lead: 'Coverage and freshness of the data behind every chart.', cards: () => [...(HAS_RESULTS ? [coverageCard().el] : []), ...(RUNS.some(r => r.feed) ? [freshCard().el] : [])] },
    ];
    const sub = CH.map(c => ({ id: c.id, label: c.nav }));
    const root = h('div', null, viewHead('Snapshots', () => `Every pull the pipeline saved, and how any two of them differ. ${plural(allPulls().length, 'pull')} so far${have('results') ? `, the latest results pull at ${pullClock('results', RLAST)} ET` : ''}.`), inlineSubnav(sub), ...CH.map((ch, i) => chapter(ch.id, String(i + 1), ch.title, ch.lead, ch.cards())));
    return { root, sub };
  },
};
