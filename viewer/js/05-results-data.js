/* ---------- results data: decode the compact snapshot arrays, no DOM ---------- */
const RS = D.results || null;
const HAS_RESULTS = !!RS;
const RSNAPS = RS ? RS.snaps : [];
const RLAST = RSNAPS.length - 1;
const RACES = RS ? RS.races : [];
const EWV = [], LVV = [];                       // per snapshot, carried forward from the last snapshot that changed
const LR = RS ? RS.lraces : [];
const LOCAL_BY_COUNTY = new Map();
if (RS) {
  let prev = {}; RS.ew.forEach(ch => { const cur = { ...prev }; for (const k in ch) cur[k] = ch[k]; EWV.push(cur); prev = cur; });
  let pl = null; RS.lv.forEach(x => { pl = x || pl; LVV.push(pl); });
  RACES.forEach((r, i) => { r.i = i; r.nc = r.cands.length; r.rowIdx = new Map(r.rows.map((ci, k) => [ci, k])); r.hasTotal = r.rowIdx.has(-1); });
  let off = 0;
  LR.forEach((l, i) => { l.i = i; l.off = off; off += l.cands.length; (LOCAL_BY_COUNTY.get(l.ci) || LOCAL_BY_COUNTY.set(l.ci, []).get(l.ci)).push(i); });
}
const RACE_BY_ID = new Map(RACES.map(r => [r.id, r]));

/* race families, in the order a voter thinks of them */
const FAMILIES = [
  { k: 'statewide', label: 'Governor, Senate & Cabinet', kinds: ['exec', 'senate'] },
  { k: 'amend', label: 'Amendments', kinds: ['amend'] },
  { k: 'house', label: 'U.S. House', kinds: ['house'] },
  { k: 'sdist', label: 'State Senate', kinds: ['sdist'] },
  { k: 'hdist', label: 'State House', kinds: ['hdist'] },
  { k: 'judicial', label: 'Judges', kinds: ['judicial'] },
];
const familyOf = r => FAMILIES.find(f => f.kinds.includes(r.kind)) || FAMILIES[0];
const isRetention = r => r.kind === 'judicial' && /^Retain/.test(r.name);
const isYes = c => /^yes\b/i.test(c[0]), isNo = c => /^no\b/i.test(c[0]) && !/^no party/i.test(c[0]);
const isYesNo = r => r.cands.length === 2 && r.cands.every(c => isYes(c) || isNo(c));

/* the same colors everywhere: parties keep theirs, Yes/No have their own, non-partisan candidates use a validated order */
/* Republican red, Democratic blue, Independent yellow (no party affiliation and the Independent Party of Florida) */
const PARTY_COLOR = { REP: 'var(--rep)', GOP: 'var(--rep)', DEM: 'var(--dem)', NPA: 'var(--npa)', IND: 'var(--npa)' };
const isIndep = p => p === 'NPA' || p === 'IND';
const NONPARTY = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];       // candidates without a party never borrow a party color
function candColor(cands, k) {
  const [name, party] = cands[k];
  if (isYes(cands[k])) return 'var(--early)';
  if (isNo(cands[k])) return 'var(--ed)';
  if (PARTY_COLOR[party]) return PARTY_COLOR[party];
  if (party === 'WRI' || /^write/i.test(name)) return 'var(--axis)';
  if (party) return 'var(--oth)';
  const idx = cands.slice(0, k).filter(c => !c[1] && !isYes(c) && !isNo(c) && !/^write/i.test(c[0])).length;
  return idx < NONPARTY.length ? NONPARTY[idx] : 'var(--oth)';
}
const partyChip = p => h('span', { class: 'pchip' + (p ? '' : ' none') + (isIndep(p) ? ' npa' : ''), style: p ? { background: PARTY_COLOR[p] || 'var(--oth)' } : null, title: p === 'NPA' ? 'No party affiliation (independent)' : p === 'IND' ? 'Independent Party of Florida' : p || 'No party' }, p || 'NP');
const candShort = (c) => c[2] || c[0];

/* votes, summaries */
function raceVotes(r, ci = -1, s = RLAST) {            // ci -1 is the statewide total row
  const arr = EWV[s] && EWV[s][r.i], k = r.rowIdx.get(ci);
  if (k === undefined) return null;
  return arr ? arr.slice(k * r.nc, (k + 1) * r.nc) : new Array(r.nc).fill(0);
}
function summarize(votes, cands) {
  const total = sum(votes), order = votes.map((_, i) => i).sort((a, b) => votes[b] - votes[a] || a - b);
  const lead = total ? order[0] : -1, second = order[1];
  const tie = total && second !== undefined && votes[order[0]] === votes[second];
  return { v: votes, total, order, lead: tie ? -1 : lead, margin: total && second !== undefined ? votes[order[0]] - votes[second] : 0,
    marginPct: total && second !== undefined ? 100 * (votes[order[0]] - votes[second]) / total : 0,
    shares: votes.map(x => total ? 100 * x / total : 0), cands };
}
function raceSum(r, ci = -1, s = RLAST) { const v = raceVotes(r, ci, s); return v ? summarize(v, r.cands) : null; }
const raceHasVotes = (r, s = RLAST) => { const t = raceSum(r, -1, s); return !!(t && t.total); };
const anyResults = (s = RLAST) => RACES.some(r => raceHasVotes(r, s));
const raceCounties = r => r.rows.filter(c => c >= 0);
function raceCountiesIn(r, ci) { return r.rowIdx.has(ci); }
const winnerParty = (r, sm) => sm && sm.lead >= 0 ? r.cands[sm.lead][1] : '';

/* county reporting status (Florida Election Watch) */
function csGet(s, ci, j) { const v = RS.cs[s][ci * 6 + j]; return v < 0 ? null : v; }
const CS = { turnout: 0, repPct: 1, compPct: 2, vbm: 3, early: 4, prov: 5 };
function edTurnout(s, ci) { const v = RS.ed[s][ci]; return v < 0 ? null : v; }
function ballotsCast(s, ci) {
  const a = csGet(s, ci, CS.turnout);
  if (a) return a;
  const j = RS.enr.ci.indexOf(ci);
  const b = j >= 0 ? RS.enr.st[s][j * 3] : -1;
  return b > 0 ? b : (a || 0);
}
function stateReporting(s = RLAST) {
  let ballots = 0, counties = 0, pw = 0, pn = 0;
  for (let ci = 0; ci < N; ci++) {
    const t = ballotsCast(s, ci) || 0;                 // the state's figure, else the county's own site
    let p = csGet(s, ci, CS.repPct);
    if (!p) { const j = RS.enr.ci.indexOf(ci), tot = j >= 0 ? RS.enr.st[s][j * 3 + 2] : -1; if (tot > 0) p = 100 * RS.enr.st[s][j * 3 + 1] / tot; }
    ballots += t; if (t > 0) counties++;
    if (p !== null) { pw += p * C[ci].precincts; pn += C[ci].precincts; }
  }
  return { ballots, counties, precinctPct: pn ? pw / pn : 0 };
}
const countyReportingPct = (ci, s = RLAST) => csGet(s, ci, CS.repPct);

/* county contests from the county election sites (local races, plus the statewide ones with the voting-method split) */
const lvotes = (l, s = RLAST) => LVV[s] ? LVV[s].slice(l.off, l.off + l.cands.length) : l.cands.map(() => 0);
const lmethod = l => l.cands.map((_, k) => RS.lm.slice((l.off + k) * 4, (l.off + k) * 4 + 4));   // [election day, early, mail, provisional]
const LOCAL_KINDS = [
  ['Commission & mayor', /commission|commissioner|mayor|council|alderman|selectman|supervisor of|town clerk|village/i],
  ['School board', /school board|school district/i],
  ['Sheriff & county officers', /sheriff|clerk|property appraiser|tax collector|supervisor of elections|constable|surveyor/i],
  ['Judges', /judge|court|justice|retention|retain|circuit/i],
  ['Ballot questions', /amendment|referendum|question|charter|bond|millage|proposition/i],
  ['Districts', /soil|water|cdd|community development|special district|fire|hospital|drainage|library|conservation/i],
];
function localKind(name) { const m = LOCAL_KINDS.find(([, re]) => re.test(name)); return m ? m[0] : 'Other local'; }
function countyBallot(ci) {                            // everything on one county's ballot, in a sensible order
  return (LOCAL_BY_COUNTY.get(ci) || []).map(i => LR[i]);
}

/* time */
const snapDate = s => new Date(RSNAPS[s].t);
const fmtClock = iso => new Intl.DateTimeFormat('en-US', { ...ET, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const fmtDayClock = iso => new Intl.DateTimeFormat('en-US', { ...ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const snapLabel = s => fmtDayClock(RSNAPS[s].t);

/* a short sentence for a race result, used by cards and headlines */
function leaderPhrase(r, sm) {
  if (!sm || !sm.total) return 'No votes counted yet';
  if (sm.lead < 0) return 'Tied';
  const c = r.cands[sm.lead];
  return `${candShort(c)} leads by ${fPct(sm.marginPct)}`;
}
