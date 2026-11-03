/* ---------- the data checks: a card in Snapshots > Pipeline health, and a status chip on the Overview ---------- */
const ckWhen = u => (u ? fmtDayClock(u) : '');

function checksChip() {
  const cls = { clear: ' ok', notice: '', warning: ' warn', critical: ' alert' }[CK.status] || '';
  return h('a', { class: 'spill' + cls, href: viewHref('snapshots', 'snap-checks'), title: 'What the source and data checkers flagged' }, `Data checks: ${ckSummary()}`);
}

function drawChecks(host, w, api) {
  const items = CK.items || [];
  host.append(h('div', { class: 'chk-banner', 'data-status': CK.status },
    h('span', { class: 'mini-note' }, `Open flags, plus anything raised in the last ${CK.window || 3} hours${CK.asOf ? `. Last checked ${fmtDayClock(CK.asOf)} ET` : ''}.`)));
  if (!items.length) {
    host.append(h('p', { class: 'chk-empty' }, `Nothing has been flagged in the last ${CK.window || 3} hours. Every pull is still being checked: sources that failed to answer, and any number that went down, in any race, county or precinct.`));
  } else {
    host.append(h('ul', { class: 'chk-list' }, items.slice(0, 12).map(it => h('li', { class: 'chk-item', 'data-tier': String(it.t) },
      h('span', { class: 'chk-tier' }, CK_TIER[it.t] || 'Notice'),
      h('span', { class: 'chk-head' }, it.h),
      h('span', { class: 'chk-when' }, ckWhen(it.u)),
      h('span', { class: 'chk-detail' }, [CK_WHO[it.v] || it.v, it.d].filter(Boolean).join(' · '))))));
    if (items.length > 12) host.append(h('p', { class: 'mini-note' }, `and ${items.length - 12} more: open the table view for the full list.`));
  }
  api.label(items.length ? `${ckSummary()} flagged by the source and data checkers.` : 'Nothing flagged by the source and data checkers.');
}

function checksCard() {
  return card({
    id: 'snap-checks', kicker: 'Data checks', cat: 'mochi', stack: true,
    title: () => (CK.status === 'clear' ? 'The checkers have flagged nothing' : `The checkers have flagged ${ckSummary()}`),
    sub: 'Two checkers read every pull. One asks whether each place we read from answered. The other asks whether the numbers make sense.',
    draw: drawChecks,
    foot: () => { const t = CK.totals || {}; return t.alerts != null ? `So far: ${plural(t.alerts, 'flag')} raised (${t['1'] || 0} critical, ${t['2'] || 0} warning, ${t['3'] || 0} notice).` : ''; },
    notes: {
      shows: () => (CK.status === 'clear' ? 'Nothing is flagged right now.' : `**${ckSummary()}** right now. The most serious: ${(CK.items[0] || {}).h || ''}`),
      what: 'Two checkers run after every pull. The **source checker** asks whether the state results site, each county site, the turnout feeds and the forecasts all answered. The **data checker** asks whether the numbers make sense: counts only ever go up, parts add up to their totals, and nothing is negative or impossible.',
      how: 'Each flag has a tier. **Critical** means look now (votes disappeared, a source is down). **Warning** means look soon. **Notice** is good to know (a county came online, a race was called). The table view lists everything flagged, newest first.',
      watch: 'A flag is not a verdict. Counties correct their counts, and a dip of a few votes is usually a correction. The checker flags every drop of any size, in every race, then sorts it by how big it is.',
    },
    table: () => ({
      head: ['When (ET)', 'Tier', 'Checker', 'What happened', 'Detail'],
      rows: (CK.log || []).slice().reverse().map(r => [ckWhen(r.u), `${CK_TIER[r.t] || 'Notice'}${r.e === 'cleared' ? ' (cleared)' : r.e === 'escalated' ? ' (escalated)' : ''}`, CK_WHO[r.v] || r.v, r.h, r.d]),
    }),
  });
}
