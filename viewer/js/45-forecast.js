/* ---------- forecasts and race calls, placed beside the races they are about ----------
   A forecast is a prediction. Every card here keeps it visibly separate from the count, and never averages the sources:
   when DDHQ's model and the markets disagree, the disagreement is the finding. */
const partyWord = p => p === 'REP' ? 'Republican' : p === 'DEM' ? 'Democratic' : isIndep(p) ? 'Independent' : (p || 'Other');
const fcPartyLegend = pi => { const seen = []; PJR[pi].sides.forEach(sd => { if (!seen.some(x => x.p === sd.p)) seen.push(sd); }); return seen.map(sd => ({ color: pjSideColor(sd), label: partyWord(sd.p) })); };

/* one forecast race as a compact cell: [party] Name 61%  (+ a Called pill) */
function fcCell(pi, o = {}) {
  const f = pjFavorite(pi), call = pjCall(pi); if (!f) return '—';
  return h('span', { style: { whiteSpace: 'nowrap' }, title: `${PSRC_NAME[f.src]}: ${f.sideObj.n || partyWord(f.sideObj.p)} ${fProb(f.p)}` },
    partyChip(f.sideObj.p), ' ', sideName(f.sideObj), ' ', h('b', null, fProb(f.p)), o.tag ? h('span', { class: 'rb-sub' }, ' ' + f.tag) : null, call ? [' ', h('span', { class: 'spill ok', title: `DDHQ called this race ${callTime(call.at)}` }, 'Called')] : null);
}

/* how the count compares with the forecast favorite, as a sentence and a status chip */
function vsCountLine(pi) {
  const v = pjVsCount(pi), f = pjFavorite(pi); if (!v || !f) return null;
  if (v.state === 'waiting') return { cls: '', chip: 'Count not started', text: 'No votes are counted in this race yet. The forecast is a prediction; the count will sit beside it as soon as votes come in.' };
  const lead = v.sm.lead >= 0 ? candShort(v.race.cands[v.sm.lead]) : 'Tied';
  const base = `The count so far: **${lead}** ${v.sm.lead >= 0 ? `leads by ${fPct(v.sm.marginPct)}` : ''} with **${fInt(v.sm.total)}** votes counted.`;
  if (v.state === 'agrees') return { cls: 'ok', chip: 'Count agrees', text: `${base} That is the forecast favorite, ${sideName(f.sideObj)}.` };
  if (v.state === 'disagrees') return { cls: 'warn', chip: 'Count disagrees', text: `${base} The forecast favorite, ${sideName(f.sideObj)}, is behind. Early counts come from early and mail ballots, so a lead now is not a result.` };
  return { cls: '', chip: 'Too close to say', text: base };
}

/* ---- the forecast card, right under the count ---- */
function srcSub(pi, src) {
  const vol = pjVolume(pi, src), upd = pjUpdated(pi, src);
  return src === 0 ? 'model' + (upd ? ` · ${upd.slice(0, 10)}` : '') : `market${vol ? ' · ' + fMoney(vol) + ' traded' : ''}`;
}
function drawForecast(host, w, api) {
  const hd = currentContest(), pi = hd && hd.type === 'ew' ? pjIndexOf(hd.r) : null;
  if (pi == null) { emptyCard(host, hd ? 'No forecaster covers this race. DDHQ models the governor, the U.S. Senate seat and all U.S. House seats; the markets add the governor, the Senate seat, CFO and a few House seats.' : 'No race selected.'); api.label('No forecast.'); return; }
  const R = PJR[pi], srcs = pjSources(pi), f = pjFavorite(pi), call = pjCall(pi), spread = pjSpread(pi), tally = pjTally(pi);
  const agree = srcs.every(x => { let b = -1; x.arr.forEach((v, i) => { if (v != null && (b < 0 || v > x.arr[b])) b = i; }); return b === f.side; });
  host.append(h('div', { class: 'kpis', style: { marginTop: 0, marginBottom: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } },
    kpiTile('Forecast favorite', `${sideName(f.sideObj)} ${fProb(f.p)}`, `${f.tag} ${partyWord(f.sideObj.p)} · ${PSRC_SHORT[f.src]}`),
    kpiTile('Sources', `${srcs.length} of 3`, srcs.length < 2 ? 'only one source covers this race' : agree ? 'all agree on the favorite' : 'they disagree on the favorite'),
    kpiTile('Race call', call ? `${pjSurname(call.name)} (${partyWord(call.party)})` : 'Not called', call ? `DDHQ · ${callTime(call.at)}` : 'DDHQ makes the call'),
    ...(spread != null ? [kpiTile('Widest gap', `${spread.toFixed(1)} pts`, 'between sources, for the favorite')] : [])));
  const rows = srcs.map(({ src, arr }) => {
    let best = -1; arr.forEach((v, i) => { if (v != null && (best < 0 || v > arr[best])) best = i; });
    return { label: PSRC_NAME[src], sub: srcSub(pi, src), hi: src === f.src,
      parts: R.sides.map((sd, i) => arr[i] == null ? null : { label: sideName(sd), color: pjSideColor(sd), value: arr[i] }).filter(Boolean),
      text: `${sideName(R.sides[best])} ${fProb(arr[best])}`,
      tip: () => tipContent(PSRC_NAME[src], R.sides.map((sd, i) => arr[i] == null ? null : { color: pjSideColor(sd), label: `${sd.n || partyWord(sd.p)} (${partyWord(sd.p)})`, value: fProb(arr[i]) }).filter(Boolean),
        [srcSub(pi, src), src === 0 ? 'A model: polls, past results and fundamentals' : 'A market: what traders pay for a $1 "Yes" share'].filter(Boolean)) };
  });
  kitStack(host, w, rows, { mode: 'share', fixed: 1, rowH: 54, barH: 26, rightPad: Math.min(140, w * .26), labelW: Math.min(170, w * .3), fmtPart: p => fProb(p.value) });
  const note = [];
  if (spread != null && spread >= 5) note.push(`The sources are ${spread.toFixed(0)} points apart on the favorite. That gap is information, so the card shows each source instead of an average.`);
  if (tally && tally[1] > 0) note.push(`DDHQ’s own tally: ${fInt(tally[0])} of ${fInt(tally[1])} precincts in. That is DDHQ’s estimate, not our count.`);
  if (note.length) host.append(h('p', { class: 'mini-note', style: { marginTop: '8px' } }, note.join(' ')));
  const vs = vsCountLine(pi);
  if (vs) host.append(h('div', { class: 'callout', style: { marginTop: '12px' } }, h('span', { class: 'spill ' + vs.cls, style: { marginRight: '8px' } }, vs.chip), rich(vs.text)));
  // history: only when something moved
  const xs = PSNAPS.map(x => new Date(x.t).getTime()), series = srcs.map(({ src }) => ({ name: PSRC_SHORT[src], color: src === 0 ? 'var(--ink)' : src === 1 ? 'var(--ink-2)' : 'var(--ink-3)', dash: src === 2 ? '5 4' : src === 1 ? '2 3' : null, width: src === 0 ? 2.5 : 2,
    ys: PSNAPS.map((_, s) => { const a = pjProbs(pi, s)[src][f.side]; return a == null ? null : 100 * a; }) }));
  const moved = series.some(se => { const v = se.ys.filter(y => y != null); return v.length > 1 && Math.max(...v) - Math.min(...v) >= .05; });
  const hist = h('div', { style: { marginTop: '14px' } }); host.append(hist);
  if (PSNAPS.length >= 2 && moved) {
    hist.append(h('p', { class: 'mini-note', style: { margin: '0 0 4px', fontWeight: 800, color: 'var(--ink-2)' } }, `${sideName(f.sideObj)}’s win probability across ${PSNAPS.length} saved pulls`));
    kitLines(hist, w, xs, series, { yFmt: v => v + '%', endFmt: v => fPct(v, 1), yMin: 0, yMax: 100, height: 200, xFmt: (m, i) => fmtClock(PSNAPS[i].t), tipHead: i => `${fmtDayClock(PSNAPS[i].t)} ET`, tipFmt: v => fPct(v, 1) });
  } else hist.append(h('p', { class: 'mini-note' }, PSNAPS.length >= 2 ? `The probabilities have not changed across the ${PSNAPS.length} pulls saved so far. A line chart of how they move appears here once they do.` : 'Only one pull is saved so far. As the night goes on, a line chart of how the odds moved appears here.'));
  api.label(`Win probabilities for ${R.name} from ${srcs.map(x => PSRC_SHORT[x.src]).join(', ')}.`);
}
function forecastCard() {
  let api;
  api = card({
    id: 'r-forecast', kicker: '100% stacked bar chart', cat: 'pearl', stack: true,
    title: () => { const hd = currentContest(), pi = hd && hd.type === 'ew' ? pjIndexOf(hd.r) : null; if (pi == null) return 'Forecasts'; const f = pjFavorite(pi), c = pjCall(pi); return c ? `DDHQ has called ${hd.name} for ${pjSurname(c.name)}` : f.p < .6 ? `Forecasts call ${hd.name} a toss-up` : `${sideName(f.sideObj)} is the forecast favorite in ${hd.name}, at ${fProb(f.p)}`; },
    sub: 'What forecasters and prediction markets expect. These are predictions, not votes.',
    legend: () => { const hd = currentContest(), pi = hd && hd.type === 'ew' ? pjIndexOf(hd.r) : null; return pi == null ? [] : fcPartyLegend(pi); },
    draw: drawForecast,
    notes: {
      what: 'A forecast turns evidence (polls, past results, money, the mix of voters) into a win probability. A prediction market is a different kind of forecast: traders buy a "Yes" share that pays $1 if the candidate wins, so the price is a probability.',
      how: 'Each bar is one source’s chance of winning, split between the candidates (red Republican, blue Democratic, yellow independent). A bold label marks the source behind the headline. Sources are never averaged.',
      shows: () => { const hd = currentContest(), pi = hd && hd.type === 'ew' ? pjIndexOf(hd.r) : null; if (pi == null) return 'This race has no forecast.'; const f = pjFavorite(pi), sp = pjSpread(pi); return `**${sideName(f.sideObj)}** is the favorite at **${fProb(f.p)}** (${f.tag.toLowerCase()}). ${sp != null ? `Sources are **${sp.toFixed(1)}** points apart.` : 'One source covers it.'}`; },
      watch: 'A 61% chance to win is not 61% of the vote. It means that if this election ran many times, that candidate would win about 6 times in 10. Thin markets (little money traded) can move on a few trades.',
      nerd: { title: 'why not average the sources?', text: 'A model, a busy market and a thin market are different instruments with different strengths. Averaging them would hide exactly the cases worth noticing: a market far from the model means traders know, or believe, something the model does not.' },
    },
    table: () => { const hd = currentContest(), pi = hd && hd.type === 'ew' ? pjIndexOf(hd.r) : null; if (pi == null) return { head: ['Race'], rows: [] }; const R = PJR[pi]; return { head: ['Source', ...R.sides.map(sd => `${sideName(sd)} (${partyWord(sd.p)})`)], align: ['l', ...R.sides.map(() => 'n')], rows: pjSources(pi).map(({ src, arr }) => [PSRC_NAME[src], ...arr.map(v => v == null ? '—' : fProb(v))]) }; },
  });
  // only races with a forecast show this card
  const gate = live(h('span', { hidden: true }), () => { const hd = currentContest(); api.el.hidden = !(HAS_PROJ && hd && hd.type === 'ew' && hasForecast(hd.r)); return null; });
  api.el.append(gate);
  return api;
}

/* ---- the forecast scoreboard: every forecast race, with the count beside it ---- */
const fcState = { key: 'close', dir: 1 };
function fcRows() {
  const ci = scopeCi();
  return PJR.map(R => {
    const race = R.rid ? RACE_BY_ID.get(R.rid) : null;
    if (ci != null && !(race && race.rowIdx.has(ci))) return null;
    const f = pjFavorite(R.i), vs = pjVsCount(R.i), call = pjCall(R.i), pr = pjProbs(R.i);
    return { R, race, f, vs, call, close: f ? Math.abs(f.p - .5) : 1, spread: pjSpread(R.i), p: src => f && pr[src][f.side] != null ? pr[src][f.side] : null };
  }).filter(Boolean);
}
function drawFcBoard(host) {
  const rows = fcRows();
  const cols = [
    { k: 'name', t: 'Race', get: x => x.R.name, cls: 'wrapcell namecell', node: x => h('div', null, h('div', { class: 'rb-name' }, x.race ? x.race.name : x.R.name), h('div', { class: 'rb-sub' }, x.race ? familyOf(x.race).label : x.R.office + (x.race ? '' : ' · no opponent on the ballot'))) },
    { k: 'close', t: 'Forecast favorite', get: x => x.close, node: x => x.f ? h('span', { style: { whiteSpace: 'nowrap' } }, partyChip(x.f.sideObj.p), ' ', sideName(x.f.sideObj), ' ', h('b', null, fProb(x.f.p)), h('span', { class: 'rb-sub' }, ' ' + x.f.tag)) : '—' },
    ...[0, 1, 2].map(src => ({ k: 'p' + src, t: PSRC_SHORT[src], n: true, get: x => x.p(src) ?? -1, fmt: v => v >= 0 ? fProb(v) : '—' })),
    { k: 'spread', t: 'Gap (pts)', n: true, cls: 'hide-sm', get: x => x.spread ?? -1, fmt: v => v >= 0 ? v.toFixed(1) : '—' },
    { k: 'call', t: 'Race call', get: x => x.call ? 1 : 0, node: x => x.call ? h('span', { class: 'spill ok', title: callTime(x.call.at) }, `${pjSurname(x.call.name)}`) : h('span', { class: 'rb-sub' }, 'not called') },
    { k: 'count', t: 'The count', get: x => x.vs ? ['agrees', 'tied', 'unknown', 'waiting', 'disagrees'].indexOf(x.vs.state) : 9, node: x => !x.vs ? '—' : x.vs.state === 'waiting' ? h('span', { class: 'rb-sub' }, 'not started') : h('span', { class: 'spill ' + (x.vs.state === 'agrees' ? 'ok' : x.vs.state === 'disagrees' ? 'warn' : '') }, x.vs.state === 'agrees' ? 'Agrees' : x.vs.state === 'disagrees' ? 'Disagrees' : 'Close') },
  ];
  host.append(kitTable(cols, rows, fcState, () => drawFcBoard(clear(host)), { onRow: x => { if (x.race) setContest(x.race.id); }, rowClass: x => x.race && (RES.key || '160000') === x.race.id ? 'sel' : '', maxH: '520px', minW: '760px', empty: scopeC() ? `No forecast covers ${scopeName()}.` : 'No forecasts.', label: 'Forecast scoreboard' }));
}
function forecastBoardCard() {
  return card({
    id: 'r-fcboard', kicker: 'Table', cat: 'pearl', stack: true, noTable: true,
    title: () => { const rows = fcRows(), tos = rows.filter(x => x.f && x.f.p < .6).length, n = rows.length; return scopeC() ? `${plural(n, 'forecast race')} touch ${scopeName()}` : `${n} races have a forecast, and ${tos === 0 ? 'none is a toss-up' : tos === 1 ? 'one is a toss-up' : tos + ' are toss-ups'}`; },
    sub: () => `DDHQ’s model, Kalshi and Polymarket for each race, closest first. Click a row to open the race.${anyResults() ? ' The last column compares the forecast favorite with the count.' : ''}`,
    foot: () => `${plural(PSNAPS.length, 'projection pull')} saved, latest ${fmtDayClock(PSNAPS[PLAST].t)} ET. Nobody forecasts the attorney general, agriculture commissioner, legislature, judges or amendments.`,
    draw: host => drawFcBoard(host),
    notes: {
      what: 'A scoreboard lines every forecast race up in one table, so you can see where the models and markets expect a close finish and where they agree.',
      how: 'Each column is one source’s chance for the favorite. "Gap" is the spread between the highest and lowest source. Once votes are counted, "The count" says whether the leader matches the forecast favorite.',
      shows: () => { const rows = fcRows().filter(x => x.f), w = [...rows].sort((a, b) => (b.spread ?? -1) - (a.spread ?? -1))[0], c = [...rows].sort((a, b) => a.close - b.close)[0]; return rows.length ? `Closest: **${c.R.name}** at **${fProb(c.f.p)}** for ${sideName(c.f.sideObj)}. Biggest disagreement: **${w.R.name}**${w.spread != null ? ` (**${w.spread.toFixed(1)}** points)` : ''}.` : 'No forecast covers this selection.'; },
      watch: 'A forecast is a probability, not a result. Favorites lose sometimes, and a 90% favorite should lose about one race in ten.',
    },
  });
}

/* ---- seats: what the forecasts add up to, beside the count ---- */
function expectedSeats(office = 'US House') {
  const out = { rep: 0, dem: 0, ind: 0, oth: 0, n: 0, called: { rep: 0, dem: 0, ind: 0, oth: 0, n: 0 } };
  PJR.filter(R => R.office === office).forEach(R => {
    const f = pjFavorite(R.i, PLAST, 0) || pjFavorite(R.i); if (!f) return;
    const P = pjProbs(R.i)[f.src]; out.n++;
    R.sides.forEach((sd, i) => { const v = P[i]; if (v == null) return; if (sd.p === 'REP') out.rep += v; else if (sd.p === 'DEM') out.dem += v; else if (isIndep(sd.p)) out.ind += v; else out.oth += v; });
    const c = pjCall(R.i); if (c) { out.called.n++; const p = c.party; if (p === 'REP') out.called.rep++; else if (p === 'DEM') out.called.dem++; else if (isIndep(p)) out.called.ind++; else out.called.oth++; }
  });
  return out;
}
