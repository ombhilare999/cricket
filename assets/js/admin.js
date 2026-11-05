(function () {
  'use strict';
  // The admin page talks to GitHub directly. The "admin key" is a fine-grained GitHub
  // token that can only start this repo's workflow (Actions: read/write) and read its
  // contents. It is kept only in this browser and is never part of the site itself.
  // Anyone without it can open this page but can't do anything.
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'tbf.adminKey';
  let config, season, gh, pollTimer;

  const getKey = () => {
    try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  };
  const setKey = (v, remember) => {
    try {
      sessionStorage.removeItem(KEY);
      localStorage.removeItem(KEY);
      if (v) (remember ? localStorage : sessionStorage).setItem(KEY, v);
    } catch (e) { /* storage blocked: key lives only for this page view */ }
  };
  let memKey = '';

  async function api(path, opts) {
    const r = await fetch('https://api.github.com/repos/' + gh.repo + path, Object.assign({}, opts, {
      headers: {
        authorization: 'Bearer ' + (memKey || getKey()),
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
    }));
    if (r.status === 204) return {};
    let body = {};
    try { body = await r.json(); } catch (e) { /* empty */ }
    if (!r.ok) throw Object.assign(new Error(body.message || 'GitHub returned ' + r.status), { status: r.status });
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
    gh = config.github;
    $('tournament').insertAdjacentHTML('beforeend', config.tournaments.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join(''));
    $('login').addEventListener('submit', login);
    $('ingest').addEventListener('submit', ingest);
    $('logout').addEventListener('click', () => { setKey(''); memKey = ''; location.reload(); });
    renderParsed();
    if (getKey()) unlock().catch(() => setKey(''));
  }

  async function login(e) {
    e.preventDefault();
    memKey = $('pw').value.trim();
    msg('login-msg');
    try {
      await unlock();
      setKey(memKey, $('remember').checked);
    } catch (err) {
      memKey = '';
      msg('login-msg', 'warn', err.status === 401 || err.status === 403 || err.status === 404
        ? '<strong>That key was not accepted.</strong>Check that the token is for <code>' + esc(gh.repo) + '</code> with <b>Actions: Read and write</b> permission, and has not expired.'
        : esc(err.message));
    }
  }

  async function unlock() {
    // succeeds only if the key can see this repo's workflows
    await api('/actions/workflows/' + gh.workflow);
    $('login').hidden = true;
    $('panel').hidden = false;
    refreshRuns();
  }

  function parseLink(url) {
    try {
      const u = new URL(url);
      if (!/(^|\.)cricclubs\.com$/i.test(u.hostname)) return null;
      const league = u.pathname.split('/').filter(Boolean)[0];
      const id = [...u.searchParams].find(([k]) => k.toLowerCase() === 'matchid');
      if (!league || !/^[A-Za-z0-9_-]+$/.test(league) || !id || !/^\d+$/.test(id[1])) return null;
      return { key: league.toLowerCase() + '-' + id[1], matchId: id[1], league: league };
    } catch (e) { return null; }
  }

  async function ingest(e) {
    e.preventDefault();
    const url = $('url').value.trim();
    const m = parseLink(url);
    if (!m) return msg('ingest-msg', 'warn', 'Paste a <b>cricclubs.com</b> match link that contains <code>matchId=</code>.');
    $('go').disabled = true;
    msg('ingest-msg', '', 'Checking…');
    try {
      // once per match: refuse if this match's data file already exists
      let exists = true;
      try { await api('/contents/data/matches/' + m.key + '.json?ref=' + encodeURIComponent(gh.branch)); } catch (err) { if (err.status === 404) exists = false; else throw err; }
      if (exists) return msg('ingest-msg', 'warn', '<strong>Already parsed</strong>Match ' + esc(m.matchId) + ' is already in the stats. Each match can only be parsed once.');
      const running = (await api('/actions/workflows/' + gh.workflow + '/runs?per_page=10&status=in_progress')).workflow_runs || [];
      if (running.some((r) => (r.display_title || '').includes('matchId=' + m.matchId))) {
        return msg('ingest-msg', 'warn', '<strong>Already running</strong>This match is being parsed right now.');
      }
      await api('/actions/workflows/' + gh.workflow + '/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: gh.branch, inputs: { url: url, tournament: $('tournament').value } }),
      });
      msg('ingest-msg', 'ok', '<strong>Started</strong>Parsing match ' + esc(m.matchId) + '. The stats update about a minute after the run below turns green.');
      $('url').value = '';
      setTimeout(refreshRuns, 4000);
    } catch (err) {
      msg('ingest-msg', 'warn', esc(err.message));
    } finally {
      $('go').disabled = false;
    }
  }

  async function refreshRuns() {
    clearTimeout(pollTimer);
    try {
      const runs = (await api('/actions/workflows/' + gh.workflow + '/runs?per_page=6&event=workflow_dispatch')).workflow_runs || [];
      $('runs').innerHTML = runs.length ? runs.map((r) =>
        '<li><span><a href="' + esc(r.html_url) + '" target="_blank" rel="noopener">' + esc(r.display_title || 'Run #' + r.run_number) + '</a><br><small class="muted">' + new Date(r.created_at).toLocaleString() + '</small></span>' +
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
