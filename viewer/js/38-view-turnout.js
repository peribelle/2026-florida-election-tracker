/* ---------- shared view furniture ---------- */
const scopeBadge = () => live(h('div'), () => scopeC() ? h('span', { class: 'scope-badge' }, `Tailored to ${scopeLabel()}`,
  h('button', { type: 'button', onclick: () => selection.set(null) }, 'Show all of Florida')) : null);
function viewHead(title, lead) {
  return h('header', { class: 'view-head' }, h('h1', null, title), lead ? live(h('p'), typeof lead === 'function' ? lead : () => lead) : null, scopeBadge());
}

/* ---------- the Turnout view: the original chapters, now answering for Florida or the selected county ---------- */
const TURNOUT_CHAPTERS = () => [
  { id: 'big-picture', nav: 'Big picture', title: () => scopeC() ? `The big picture in ${scopeName()}` : 'The big picture',
    lead: () => { const T = totalsFor(scopeCi()); return `**${fInt(T.total)}** ballots are in${scopeC() ? ' in ' + scopeLabel() : ''}. Mail brought **${fInt(T.mail)}**, in-person early voting **${fInt(T.early)}**${HAS_ED ? ` and Election Day **${fInt(T.ed)}**` : ''}.`; },
    cards: () => [pearlCard().el, typeBarsCard().el] },
  { id: 'over-time', nav: 'Over time', title: () => 'Over time',
    lead: () => `Voting built slowly through September, then jumped when early voting opened on **${EV_OPEN ? EV_OPEN.short : ''}**.${scopeC() ? ` Showing ${scopeLabel()}.` : ''}`,
    cards: () => [dailyCard().el, cumulativeCard().el, calendarCard().el] },
  { id: 'place', nav: 'Place', title: () => 'Place',
    lead: () => scopeC() ? `**${scopeName()}** is **#${scopeC().rank}** of ${N} counties on turnout (**${fPct(scopeC().rate)}**). Florida overall: **${fPct(ST.rate)}**.`
      : `**${BY_RATE[0].name}** leads on turnout at **${fPct(BY_RATE[0].rate)}**. **${BY_RATE[N - 1].name}** trails at **${fPct(BY_RATE[N - 1].rate)}**. The statewide figure is **${fPct(ST.rate)}**.`,
    cards: () => [mapCard().el, rankedCard().el, tableCard().el] },
  { id: 'party', nav: 'Party', title: () => 'Party',
    lead: () => { const ps = [...partyStatsFor(scopeCi())].sort((a, b) => b.rate - a.rate); return `**${ps.map(g => `${g.name} ${fPct(g.rate)}`).slice(0, 3).join('**, **')}**${scopeC() ? ` in ${scopeName()}` : ''}. Party here means how a voter registered, not how they voted.`; },
    cards: () => [partyRateCard().el, shareCard().el, dumbbellCard().el, partyMixCard().el, gapCard().el] },
  { id: 'spread', nav: 'Spread', title: () => 'How spread out is turnout?',
    lead: () => { const q = sorted(COUNTY_RATES); return `Half of all counties sit between **${fPct(quantile(q, .25))}** and **${fPct(quantile(q, .75))}**. Precincts vary far more, and the smallest ones swing the most.`; },
    cards: () => [histCard().el, boxCard().el, scatterCard().el, funnelCard().el] },
  { id: 'busiest', nav: 'Busiest', title: () => scopeC() ? `Busiest places and days in ${scopeName()}` : 'Busiest places and days',
    lead: () => scopeC() ? `Early-voting sites and daily rhythm in **${scopeLabel()}**.` : `**${TOP_SITES[0].name}** in ${TOP_SITES[0].county} County drew the most ballots at **${fInt(TOP_SITES[0].t)}**. ${TOP_SITES.filter(x => x.lib).length} of the top 15 sites are libraries.`,
    cards: () => [sitesCard().el, heatCard().el, smallCard().el] },
];
VIEWS.turnout = {
  build() {
    const CH = TURNOUT_CHAPTERS(), sub = CH.map(ch => ({ id: ch.id, label: ch.nav }));
    const root = h('div', null, viewHead('Turnout', () => `Who has voted so far, how, when and where${scopeC() ? ' in ' + scopeLabel() : ''}. Unofficial counts from the county feeds.`), inlineSubnav(sub),
      ...CH.map((ch, i) => chapter(ch.id, String(i + 1), ch.title, ch.lead, ch.cards())));
    return { root, sub };
  },
};
