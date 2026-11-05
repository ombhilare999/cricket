(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let config, season, api, pollTimer;

  // The password lives only in this tab's session storage and is checked by the
  // admin API (a Cloudflare Worker) on every request. Nothing secret ships in this page.
  const getPw = () => { try { return sessionStorage.getItem('tbf.pw') || ''; } catch (e) { return ''; } };
  const setPw = (v) => { try { v ? sessionStorage.setItem('tbf.pw', v) : sessionStorage.removeItem('tbf.pw'); } catch (e) { /* ignore */ } };

  async function call(path, opts) {
    const r = await fetch(api + path, Object.assign({ headers: { 'content-type': 'application/json', authorization: 'Bearer ' + getPw() } }, opts || {}));
    let body = {};
    try { body = await r.json(); } catch (e) { /* non-json */ }
    if (!r.ok) throw Object.assign(new Error(body.error || 'Request failed (' + r.status + ')'), { status: r.status });
    return body;
  }

  function msg(el, kind, html) {
    $(el).innerHTML = html ? '<div class="callout ' + (kind || '') + '">' + html + '</div>' : '';
  }

  async function boot() {
    [config, season] = await Promise.all([
      fetch('data/config.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/season.json', { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    api = String(config.adminApi || '').replace(/\/$/, '');
    $('tournament').insertAdjacentHTML('beforeend', config.tournaments.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join(''));
    if (!api || /YOUR-SUBDOMAIN/.test(api)) {
      msg('login-msg', 'warn', '<strong>Admin API not configured</strong>Set <code>adminApi</code> in <code>data/config.json</code> to your Worker URL (see README).');
    }
    $('login').addEventListener('submit', login);
    $('ingest').addEventListener('submit', ingest);
    $('logout').addEventListener('click', () => { setPw(''); location.reload(); });
    renderParsed();
    if (getPw()) unlock().catch(() => setPw(''));
  }

  async function login(e) {
    e.preventDefault();
    setPw($('pw').value);
    msg('login-msg');
    try {
      await unlock();
    } catch (err) {
      setPw('');
      msg('login-msg', 'warn', err.status === 401 ? 'Wrong password.' : esc(err.message));
    }
  }

  async function unlock() {
    await call('/auth', { method: 'POST' });
    $('login').hidden = true;
    $('panel').hidden = false;
    refreshRuns();
  }

  async function ingest(e) {
    e.preventDefault();
    const url = $('url').value.trim();
    const id = matchKey(url);
    if (!id) return msg('ingest-msg', 'warn', 'Paste a CricClubs link that contains <code>matchId=</code>.');
    if (season.matches.some((m) => m.id === id)) return msg('ingest-msg', 'warn', '<strong>Already parsed</strong>This match is already in the stats. Each match can only be parsed once.');
    $('go').disabled = true;
    msg('ingest-msg', '', 'Sending…');
    try {
      const r = await call('/ingest', { method: 'POST', body: JSON.stringify({ url: url, tournament: $('tournament').value }) });
      msg('ingest-msg', 'ok', '<strong>Queued</strong>' + esc(r.message || 'Parsing has started.') + ' Follow it under Recent runs.');
      $('url').value = '';
      setTimeout(refreshRuns, 4000);
    } catch (err) {
      msg('ingest-msg', 'warn', esc(err.message));
    } finally {
      $('go').disabled = false;
    }
  }

  function matchKey(url) {
    try {
      const u = new URL(url);
      const league = u.pathname.split('/').filter(Boolean)[0];
      const id = [...u.searchParams].find(([k]) => k.toLowerCase() === 'matchid');
      return league && id && /^\d+$/.test(id[1]) ? league.toLowerCase() + '-' + id[1] : null;
    } catch (e) { return null; }
  }

  async function refreshRuns() {
    clearTimeout(pollTimer);
    try {
      const { runs } = await call('/status');
      $('runs').innerHTML = runs.length ? runs.map((r) =>
        '<li><span><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title || 'Run #' + r.number) + '</a><br><small class="muted">' + new Date(r.created_at).toLocaleString() + '</small></span>' +
        '<span class="pill ' + esc(r.conclusion || r.status) + '">' + esc(r.conclusion || r.status) + '</span></li>').join('') : '<li class="muted">No runs yet.</li>';
      if (runs.some((r) => r.status !== 'completed')) pollTimer = setTimeout(refreshRuns, 10000);
    } catch (err) {
      $('runs').innerHTML = '<li class="muted">' + esc(err.message) + '</li>';
    }
  }

  function renderParsed() {
    const list = season.matches.slice().reverse();
    $('parsed').innerHTML = list.length ? list.map((m) =>
      '<li><span>' + esc(m.date || '—') + ' · vs ' + esc(m.opponent || '?') + '<br><small class="muted">' + esc(m.id) + ' · ' + esc(m.source) + '</small></span>' +
      '<a href="' + esc(m.scorecardUrl) + '" target="_blank" rel="noopener">Scorecard ↗</a></li>').join('') : '<li class="muted">None yet.</li>';
    const un = season.unmatchedNames || [];
    $('unmatched-card').hidden = !un.length;
    $('unmatched').innerHTML = un.map((n) => '<li>' + esc(n) + '</li>').join('');
  }

  boot();
})();
