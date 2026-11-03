/* ---------- boot ---------- */
function init() {
  try { const saved = localStorage.getItem('taro-theme'); if (saved) root.dataset.theme = saved; } catch (e) { /* private mode */ }
  applyMode();
  $('#themebtn').addEventListener('click', () => {
    const next = mode() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('taro-theme', next); } catch (e) { /* ignore */ }
    applyMode(); redrawAll();
  });
  prefersDark.addEventListener('change', () => { applyMode(); redrawAll(); });
  $('#foot-stamp').textContent = `Latest county update ${stampET(SNAP)}. Page built ${stampET(D.meta.generated)}.`;
  buildCountySelect();
  if (!location.hash) history.replaceState(null, '', '#/overview');
  applyRoute();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redrawAll());
  window.__TARO__ = { ST, C, PARTIES, DAY, PEAK, TIERS, PR, PRF, SITES, WDSTAT, CUM, BY_RATE, selection, redrawAll, tierStats, boxStats, linfit, RS, RACES, route, VIEWS };
}
init();
