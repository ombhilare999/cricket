// Admin page: password lock, and adding a match straight to the repo.
//
// Flow: paste a CricClubs full-scorecard link → "Open scorecard" opens it in a new tab →
// the "Send to TBF" bookmarklet posts that tab's HTML back here (CricClubs blocks
// automated downloads, so it must come from the admin's own browser) → the same parser
// the tests use reads it → preview → "Save" commits the match, the rebuilt season and any
// roster changes to GitHub in one commit. The push redeploys the site.

import { parseMatchUrl, detectTournament, buildMatch, RejectedMatch } from './lib/match.js';
import { buildSeason, slimHtml } from './lib/season.js';
import { seal, unseal } from './lib/vault.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BASE = '../';
const SESSION_KEY = 'tbf.admin';
const CRICCLUBS_ORIGIN = /^https:\/\/(www\.)?cricclubs\.com$/i;

let session = null; // { password, token }
let config = null;
let draft = null; // the match being added

function msg(el, kind, html) {
  $(el).innerHTML = html ? '<div class="callout ' + (kind || '') + '">' + html + '</div>' : '';
}

// ------------------------------------------------------------------ lock
async function loadJson(path) {
  const r = await fetch(BASE + path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
  return r.json();
}

function remember(s) {
  session = s;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* private mode: stays unlocked until reload */ }
}

function unlocked() {
  document.body.classList.remove('locked');
  $('lock').hidden = true;
  renderSaveStatus();
}

async function initLock() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (saved && saved.password) { session = saved; unlocked(); return; }
  } catch (e) { /* ignore */ }
  $('lock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('unlock').disabled = true;
    msg('lock-msg', '', 'Checking…');
    try {
      const box = await loadJson('data/admin-key.json');
      const secret = await unseal($('pw').value, box);
      if (!secret) return msg('lock-msg', 'warn', 'Wrong password.');
      remember({ password: $('pw').value, token: secret.token || null });
      msg('lock-msg', '', '');
      unlocked();
    } catch (err) {
      msg('lock-msg', 'warn', 'Could not check the password (' + esc(err.message) + ').');
    } finally {
      $('unlock').disabled = false;
    }
  });
}

$('lock-again').addEventListener('click', () => {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  location.reload();
});

// ------------------------------------------------------------------ GitHub
async function gh(path, opts = {}) {
  const r = await fetch('https://api.github.com/repos/' + config.github.repo + path, {
    ...opts,
    headers: {
      accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      authorization: 'Bearer ' + session.token,
      'x-github-api-version': '2022-11-28',
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  if (opts.allow404 && r.status === 404) return null;
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).message || ''; } catch (e) { /* ignore */ }
    const err = new Error('GitHub ' + r.status + (detail ? ': ' + detail : ''));
    err.status = r.status;
    throw err;
  }
  return opts.raw ? r.text() : r.json();
}

function renderSaveStatus() {
  if (!config) return;
  if (session && session.token) {
    $('save-status').innerHTML = 'Saves go straight to <a href="https://github.com/' + esc(config.github.repo) + '/commits/' + esc(config.github.branch) + '" target="_blank" rel="noopener">' + esc(config.github.repo) + '</a>. <button class="linkbtn" type="button" id="disconnect">Replace token</button>';
    $('disconnect').onclick = () => { session.token = null; renderSaveStatus(); };
    return;
  }
  $('save-status').innerHTML =
    'Saving is not set up yet. Paste a GitHub <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a> ' +
    '(Repository access: only <code>' + esc(config.github.repo) + '</code>; Permissions: <b>Contents: Read and write</b>). It is stored encrypted with the admin password, so this is needed once.' +
    '<span class="inline" style="margin-top:8px"><input id="token" type="password" autocomplete="off" placeholder="github_pat_…"><button class="btn" type="button" id="connect">Connect</button></span>' +
    '<span id="connect-msg"></span>';
  $('connect').onclick = connect;
}

async function connect() {
  const token = $('token').value.trim();
  if (!token) return;
  $('connect').disabled = true;
  $('connect-msg').innerHTML = '<br>Checking the token…';
  const prev = session.token;
  session.token = token;
  try {
    const existing = await gh('/contents/data/admin-key.json?ref=' + encodeURIComponent(config.github.branch), { allow404: true });
    const box = await seal(session.password, { token });
    const content = btoa(JSON.stringify(box, null, 1) + '\n');
    await gh('/contents/data/admin-key.json', {
      method: 'PUT',
      body: { message: 'Admin: connect GitHub token', content, branch: config.github.branch, ...(existing ? { sha: existing.sha } : {}) },
    });
    remember(session);
    renderSaveStatus();
  } catch (err) {
    session.token = prev;
    $('connect').disabled = false;
    $('connect-msg').innerHTML = '<br><span class="bad">' + esc(err.status === 401 ? 'GitHub did not accept that token.' : err.status === 403 || err.status === 404 ? 'That token cannot write to ' + config.github.repo + '. Give it Contents: Read and write on this repository.' : err.message) + '</span>';
  }
}

// ------------------------------------------------------------------ bookmarklet
// Runs on the CricClubs tab. Sends the page to the admin tab that opened it, or copies it.
const BOOKMARKLET = `(function(){
var h='<!doctype html>'+document.documentElement.outerHTML.replace(/<script[\\s\\S]*?<\\/script>/gi,'');
var d={type:'tbf-scorecard',url:location.href,html:h};
if(!/fullScorecard/i.test(location.href)){alert('Open the CricClubs Full Scorecard page first.');return;}
if(window.opener&&!window.opener.closed){window.opener.postMessage(d,'*');alert('Sent to TBF admin. You can close this tab.');return;}
navigator.clipboard.writeText(JSON.stringify(d)).then(function(){alert('Copied. Go back to the TBF admin page and press Paste from clipboard.');},function(){alert('Could not send the scorecard. Save the page (Cmd+S) and upload it on the admin page.');});
})();`;

function initBookmarklet() {
  const a = $('bookmarklet');
  a.href = 'javascript:' + encodeURIComponent(BOOKMARKLET.replace(/\n/g, ''));
  a.addEventListener('click', (e) => {
    e.preventDefault();
    msg('add-msg', '', 'Drag the <b>Send to TBF</b> button to your bookmarks bar, then click it on the CricClubs scorecard tab.');
  });
}

window.addEventListener('message', (e) => {
  if (!CRICCLUBS_ORIGIN.test(e.origin) || !e.data || e.data.type !== 'tbf-scorecard') return;
  window.focus();
  receive(e.data.url, e.data.html);
});

$('open').addEventListener('click', () => {
  const raw = $('url').value.trim();
  if (!raw) return msg('add-msg', 'warn', 'Paste the full scorecard link first.');
  let info;
  try { info = parseMatchUrl(raw); } catch (err) { return msg('add-msg', 'warn', esc(err.message)); }
  // no "noopener": the bookmarklet needs window.opener to send the page back
  const w = window.open(raw, 'tbf-scorecard');
  msg('add-msg', '', w
    ? 'Opened match ' + esc(info.matchId) + ' in a new tab. Once the scorecard shows, click <b>Send to TBF</b> in your bookmarks bar.'
    : 'Your browser blocked the new tab. <a href="' + esc(raw) + '" target="tbf-scorecard">Open the scorecard</a>, then click <b>Send to TBF</b>.');
});

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const html = await f.text();
  const saved = (html.match(/<!-- saved from url=\(\d+\)(\S+) -->/) || [])[1];
  receive($('url').value.trim() || saved, html);
  e.target.value = '';
});

$('paste').addEventListener('click', async () => {
  let text;
  try { text = await navigator.clipboard.readText(); } catch (err) { return msg('add-msg', 'warn', 'The browser did not allow reading the clipboard.'); }
  try {
    const d = JSON.parse(text);
    if (d && d.type === 'tbf-scorecard') return receive(d.url, d.html);
  } catch (err) { /* not from the bookmarklet */ }
  if (/<table/i.test(text)) return receive($('url').value.trim(), text);
  msg('add-msg', 'warn', 'The clipboard does not hold a scorecard. Click the bookmark on the CricClubs tab first.');
});

// ------------------------------------------------------------------ parse + preview
function receive(url, html) {
  if (!session) return; // still locked
  if (!url) return msg('add-msg', 'warn', 'Paste the scorecard link in the box first, so the match can be identified.');
  let info;
  try { info = parseMatchUrl(url); } catch (err) { return msg('add-msg', 'warn', esc(err.message)); }
  $('url').value = url;
  if (/Just a moment|Performing security verification/i.test(html) && !/<table/i.test(html)) {
    return msg('add-msg', 'warn', 'That tab was still on the CricClubs security check. Wait for the scorecard to show, then click the bookmark again.');
  }
  const tournament = detectTournament(info.league, config);
  if (!tournament) return msg('add-msg', 'warn', '“' + esc(info.league) + '” is not one of our tournaments (' + esc(config.tournaments.map((t) => t.name).join(', ')) + ').');
  const { season, players } = window.TBFApp.data;
  if (season.matches.some((m) => m.id === info.id)) {
    const m = season.matches.find((x) => x.id === info.id);
    return msg('add-msg', 'warn', '<strong>Already added</strong>Match ' + esc(info.matchId) + ' (vs ' + esc(m.opponent || '?') + ') is already in the stats.');
  }
  draft = { info, tournament, html, players: JSON.parse(JSON.stringify(players)), rosterChanges: [], extraPlayers: [], date: null };
  parseDraft();
}

function parseDraft() {
  msg('add-msg', '', '');
  const doc = new DOMParser().parseFromString(draft.html, 'text/html');
  try {
    draft.parsed = buildMatch({ doc, players: draft.players, config });
    draft.date = draft.date || draft.parsed.date;
    renderPreview();
  } catch (err) {
    draft.parsed = null;
    if (err instanceof RejectedMatch && err.unknown) return renderUnknown(err.unknown);
    $('preview').innerHTML = '';
    msg('add-msg', 'warn', '<strong>Can’t add this match</strong>' + esc(err.message));
  }
}

const fullName = (p) => p.first + ' ' + p.last;
const rosterOptions = (players) => players.slice().sort((a, b) => fullName(a).localeCompare(fullName(b)))
  .map((p) => '<option value="' + esc(p.id) + '">' + esc(fullName(p)) + '</option>').join('');

function renderUnknown(names) {
  $('preview').innerHTML =
    '<div class="callout warn"><strong>' + names.length + ' name' + (names.length > 1 ? 's' : '') + ' not on the roster</strong>' +
    'Pick who each one is. The CricClubs spelling is saved as an alias, so next time it matches by itself.</div>' +
    '<div class="map">' + names.map((n, i) =>
      '<label class="maprow"><span>' + esc(n) + '</span><select data-i="' + i + '"><option value="">Choose…</option>' +
      '<option value="__new">+ New per-match player</option>' + rosterOptions(draft.players) + '</select></label>').join('') + '</div>' +
    '<button class="btn" type="button" id="apply-map">Continue</button>';
  $('apply-map').onclick = () => {
    const picks = [...$('preview').querySelectorAll('select')].map((s) => s.value);
    if (picks.some((v) => !v)) return msg('add-msg', 'warn', 'Choose a player for every name.');
    names.forEach((n, i) => {
      const change = picks[i] === '__new' ? { kind: 'new', name: n } : { kind: 'alias', id: picks[i], name: n };
      draft.rosterChanges.push(change);
      applyRosterChange(draft.players, change);
    });
    parseDraft();
  };
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function applyRosterChange(players, c) {
  if (c.kind === 'alias') {
    const p = players.find((x) => x.id === c.id);
    if (!p) throw new Error('Player ' + c.id + ' is no longer on the roster.');
    p.aliases = [...new Set([...(p.aliases || []), c.name])];
  } else if (!players.some((x) => x.id === slug(c.name))) {
    const parts = c.name.trim().split(/\s+/);
    players.push({ id: slug(c.name), first: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0], last: parts.length > 1 ? parts[parts.length - 1] : '', tier: 'none', aliases: [] });
    players.sort((a, b) => a.id.localeCompare(b.id));
  }
}

function renderPreview() {
  const m = draft.parsed;
  const t = config.tournaments.find((x) => x.id === draft.tournament);
  const byId = new Map(draft.players.map((p) => [p.id, p]));
  const inXI = new Set(m.players.map((p) => p.playerId));
  const bat = (p) => (p.bat ? p.bat.runs + (p.bat.notOut ? '*' : '') + ' <small>(' + p.bat.balls + ')</small>' : '<span class="zero">dnb</span>');
  const bowl = (p) => (p.bowl && p.bowl.balls ? p.bowl.overs + '-' + p.bowl.runs + '-' + p.bowl.wickets : '<span class="zero">–</span>');
  const changes = draft.rosterChanges.map((c) => c.kind === 'alias'
    ? '“' + esc(c.name) + '” → alias of ' + esc(fullName(byId.get(c.id)))
    : '“' + esc(c.name) + '” → new per-match player').join('<br>');
  $('preview').innerHTML =
    '<div class="pv-head"><div><span class="tbadge ' + esc(draft.tournament) + '">' + esc(t.short) + '</span> Match ' + esc(draft.info.matchId) + '</div>' +
    '<div class="vs"><span>vs</span> ' + esc(m.opponent || 'Opponent') + '</div>' +
    (m.result ? '<div class="muted">' + esc(m.result) + '</div>' : '') + '</div>' +
    '<div class="field"><label for="pv-date">Match date</label><input id="pv-date" type="date" value="' + esc(draft.date || '') + '"></div>' +
    '<div class="table-wrap pv-table"><table class="stats"><thead><tr><th>Player</th><th>Bat R (B)</th><th>Bowl O-R-W</th></tr></thead><tbody>' +
    m.players.map((p) => '<tr><td class="player">' + esc(fullName(byId.get(p.playerId))) + (p.name.toLowerCase() !== fullName(byId.get(p.playerId)).toLowerCase() ? ' <small class="muted">' + esc(p.name) + '</small>' : '') + '</td><td class="num">' + bat(p) + '</td><td class="num">' + bowl(p) + '</td></tr>').join('') +
    '</tbody></table></div>' +
    '<p class="muted small">' + m.players.length + ' players on the card.' + (m.players.length < config.playersPerSide ? ' Someone who only fielded is not on the card: add them below so their match counts.' : '') + '</p>' +
    '<details' + (m.players.length < config.playersPerSide ? ' open' : '') + '><summary>Also played (fielded only)</summary><div class="checks">' +
    draft.players.filter((p) => !inXI.has(p.id)).sort((a, b) => fullName(a).localeCompare(fullName(b)))
      .map((p) => '<label><input type="checkbox" value="' + esc(p.id) + '"' + (draft.extraPlayers.includes(p.id) ? ' checked' : '') + '> ' + esc(fullName(p)) + '</label>').join('') +
    '</div></details>' +
    (m.notes.length ? '<div class="callout warn" style="margin-top:12px">' + m.notes.map(esc).join('<br>') + '</div>' : '') +
    (changes ? '<div class="callout" style="margin-top:12px"><strong>Roster changes saved with this match</strong>' + changes + '</div>' : '') +
    '<div class="pv-actions"><button class="btn" type="button" id="save"' + (session.token ? '' : ' disabled title="Connect GitHub first (right-hand panel)"') + '>Save match</button>' +
    '<button class="btn ghost" type="button" id="discard">Discard</button></div>' +
    (session.token ? '' : '<p class="muted small">Saving needs the GitHub token set up once (see “Saving”).</p>');
  $('pv-date').onchange = (e) => { draft.date = e.target.value || null; };
  $('preview').querySelector('.checks').onchange = () => {
    draft.extraPlayers = [...$('preview').querySelectorAll('.checks input:checked')].map((i) => i.value);
  };
  $('discard').onclick = () => { draft = null; $('preview').innerHTML = ''; msg('add-msg', '', ''); };
  $('save').onclick = save;
}

// ------------------------------------------------------------------ save
async function save() {
  const btn = $('save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const { info, tournament, parsed } = draft;
  const branch = config.github.branch;
  try {
    const ref = await gh('/git/ref/heads/' + branch);
    const head = ref.object.sha;
    const base = await gh('/git/commits/' + head);
    const path = 'data/matches/' + info.id + '.json';
    if (await gh('/contents/' + path + '?ref=' + head, { allow404: true })) throw new Error('Match ' + info.matchId + ' was added already (someone saved it a moment ago).');

    // re-apply roster changes to the latest roster, so we never overwrite someone else's edit
    const playersFile = JSON.parse(await gh('/contents/data/players.json?ref=' + head, { raw: true }));
    draft.rosterChanges.forEach((c) => applyRosterChange(playersFile.players, c));

    const record = {
      id: info.id,
      matchId: info.matchId,
      clubId: info.clubId,
      league: info.league,
      tournament,
      scorecardUrl: info.scorecardUrl,
      parsedAt: new Date().toISOString(),
      ...parsed,
      ...(draft.date && draft.date !== parsed.date ? { date: draft.date, dateOverride: draft.date } : {}),
      ...(draft.extraPlayers.length ? { extraPlayers: draft.extraPlayers } : {}),
    };

    const list = (await gh('/contents/data/matches?ref=' + head, { allow404: true })) || [];
    const existing = await Promise.all(list.filter((f) => f.name.endsWith('.json'))
      .map((f) => gh('/contents/' + f.path + '?ref=' + head, { raw: true }).then(JSON.parse)));
    const season = buildSeason([...existing, record], playersFile.players);

    const files = [
      { path, content: JSON.stringify(record, null, 1) + '\n' },
      { path: 'data/season.json', content: JSON.stringify(season, null, 1) + '\n' },
      { path: 'data/raw/' + info.id + '.scorecard.html', content: slimHtml(draft.html) },
    ];
    if (draft.rosterChanges.length) files.push({ path: 'data/players.json', content: JSON.stringify(playersFile, null, 2) + '\n' });

    const tree = await gh('/git/trees', { method: 'POST', body: { base_tree: base.tree.sha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) } });
    const t = config.tournaments.find((x) => x.id === tournament);
    const commit = await gh('/git/commits', {
      method: 'POST',
      body: { message: 'Add match ' + t.short + ' ' + info.matchId + ' vs ' + (record.opponent || 'opponent'), tree: tree.sha, parents: [head] },
    });
    await gh('/git/refs/heads/' + branch, { method: 'PATCH', body: { sha: commit.sha, force: false } });

    window.TBFApp.setData({ season, players: playersFile.players });
    draft = null;
    $('preview').innerHTML = '';
    $('url').value = '';
    msg('add-msg', 'ok', '<strong>Saved: vs ' + esc(record.opponent || 'opponent') + '</strong>The stats below include it now. The public page updates in about a minute. ' +
      '<a href="' + esc(commit.html_url || 'https://github.com/' + config.github.repo + '/commit/' + commit.sha) + '" target="_blank" rel="noopener">View commit</a>');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Save match';
    const hint = err.status === 401 ? ' The saved GitHub token no longer works: use “Replace token”.' : err.status === 422 ? ' Someone else saved at the same moment. Press Save again.' : '';
    msg('add-msg', 'warn', '<strong>Not saved</strong>' + esc(err.message) + hint);
  }
}

// ------------------------------------------------------------------ boot
(async function boot() {
  initBookmarklet();
  initLock();
  try {
    config = await loadJson('data/config.json');
    renderSaveStatus();
  } catch (err) {
    msg('add-msg', 'warn', 'Could not load the site config (' + esc(err.message) + ').');
  }
})();
