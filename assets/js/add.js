(function () {
  'use strict';
  // Submissions go through a GitHub issue form. The site is static, so the issue is what
  // starts the "Update site" workflow, which checks the rules, adds the match and replies.
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let config, season, players;

  function msg(kind, html) {
    $('msg').innerHTML = html ? '<div class="callout ' + (kind || '') + '">' + html + '</div>' : '';
  }

  // Mirrors scripts/lib/match.mjs parseMatchUrl, to give instant feedback.
  function check(raw) {
    let u;
    try { u = new URL(raw.trim()); } catch (e) { return { error: 'That is not a valid link.' }; }
    if (u.protocol !== 'https:' || !/^(www\.)?cricclubs\.com$/i.test(u.hostname)) return { error: 'The link must be on <b>cricclubs.com</b>.' };
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || parts[1].toLowerCase() !== 'fullscorecard.do') {
      return { error: 'Use the <b>full scorecard</b> link. Its address contains <code>fullScorecard.do</code>. On CricClubs, open the match and choose “Full Scorecard”.' };
    }
    const league = parts[0];
    const q = {};
    u.searchParams.forEach((v, k) => { q[k.toLowerCase()] = v; });
    if (!/^\d+$/.test(q.matchid || '')) return { error: 'The link must contain <code>matchId=</code> followed by a number.' };
    const t = config.tournaments.find((t) => t.urlKeywords.some((k) => league.toLowerCase().includes(k)));
    if (!t) return { error: '“' + esc(league) + '” is not one of our tournaments (' + esc(config.tournaments.map((t) => t.name).join(', ')) + ').' };
    const id = league.toLowerCase() + '-' + q.matchid;
    const clean = 'https://cricclubs.com/' + league + '/fullScorecard.do?' + (q.clubid ? 'clubId=' + q.clubid + '&' : '') + 'matchId=' + q.matchid;
    return { id: id, url: clean, matchId: q.matchid, tournament: t };
  }

  function submit(e) {
    e.preventDefault();
    const r = check($('url').value);
    if (r.error) return msg('warn', r.error);
    const done = season.matches.find((m) => m.id === r.id);
    if (done) return msg('warn', '<strong>Already added</strong>Match ' + esc(r.matchId) + ' (vs ' + esc(done.opponent || '?') + ') is already in the stats.');
    const issue = 'https://github.com/' + config.github.repo + '/issues/new?' + new URLSearchParams({
      template: 'add-match.yml',
      title: 'Add match: ' + r.tournament.short + ' ' + r.matchId,
      scorecard: r.url,
    });
    const w = window.open(issue, '_blank');
    if (w) w.opener = null;
    msg('ok', '<strong>Almost done</strong>' + (w ? 'A GitHub tab has opened.' : '<a href="' + esc(issue) + '" target="_blank" rel="noopener">Open the GitHub form</a>.') +
      ' Press <b>Create</b> there, then check back here. The result also appears on the issue.');
    setTimeout(loadRecent, 20000);
  }

  async function loadRecent() {
    try {
      const r = await fetch('https://api.github.com/repos/' + config.github.repo + '/issues?state=all&per_page=20&sort=created&direction=desc', { headers: { accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error('GitHub returned ' + r.status);
      const list = (await r.json()).filter((i) => !i.pull_request && /^add match/i.test(i.title)).slice(0, 8);
      $('recent').innerHTML = list.length ? list.map((i) => {
        const st = i.state === 'open' ? ['in_progress', 'Checking…'] : i.state_reason === 'completed' ? ['success', 'Added'] : ['failure', 'Not added'];
        return '<li><span><a href="' + esc(i.html_url) + '" target="_blank" rel="noopener">' + esc(i.title) + '</a><br><small class="muted">' +
          new Date(i.created_at).toLocaleString() + ' · ' + esc(i.user && i.user.login) + '</small></span><span class="pill ' + st[0] + '">' + st[1] + '</span></li>';
      }).join('') : '<li class="muted">No submissions yet.</li>';
      if (list.some((i) => i.state === 'open')) setTimeout(loadRecent, 15000);
    } catch (err) {
      $('recent').innerHTML = '<li class="muted">Could not load submissions (' + esc(err.message) + ').</li>';
    }
  }

  async function boot() {
    [config, season, { players }] = await Promise.all(['data/config.json', 'data/season.json', 'data/players.json'].map((p) => fetch(p, { cache: 'no-cache' }).then((r) => r.json())));
    $('rule-team').textContent = config.teamName;
    $('rule-tournaments').textContent = config.tournaments.map((t) => t.name).join(' or ');
    $('names').innerHTML = players.slice().sort((a, b) => (a.first + a.last).localeCompare(b.first + b.last))
      .map((p) => '<li><span>' + esc(p.first + ' ' + p.last) + (p.aliases && p.aliases.length ? '<br><small class="muted">also: ' + esc(p.aliases.join(', ')) + '</small>' : '') + '</span></li>').join('');
    $('add').addEventListener('submit', submit);
    loadRecent();
  }

  boot();
})();
