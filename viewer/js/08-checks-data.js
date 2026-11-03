/* ---------- the data checks: what the two validators (validate.py) flagged. Absent until they have run once. ---------- */
const CK = D.checks || null;
const HAS_CHECKS = !!CK;
const CK_TIER = { 1: 'Critical', 2: 'Warning', 3: 'Notice' };
const CK_WHO = { source: 'Source check', data: 'Data check' };
const CK_WORD = { 1: ['critical', 'critical'], 2: ['warning', 'warnings'], 3: ['notice', 'notices'] };
const ckCount = t => (CK && CK.counts && CK.counts[String(t)]) || 0;
const ckSummary = () => {
  if (!CK) return '';
  if (CK.status === 'clear') return 'all clear';
  return [1, 2, 3].filter(ckCount).map(t => `${ckCount(t)} ${CK_WORD[t][ckCount(t) === 1 ? 0 : 1]}`).join(', ');
};
