(function () {
  'use strict';
  const S = window.TBFStats;
  const state = {
    tournament: 'all',
    showNone: false,
    workload: 'per',
    sort: { batting: { key: 'balls', dir: -1 }, bowling: { key: 'balls', dir: -1 } },
  };
  let config, players, season;

  // ---------------------------------------------------------------- helpers
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fullName = (p) => p.first + ' ' + p.last;
  const short = (p) => p.first.split(' ')[0] + ' ' + p.last;
  const fixed = (v, d) => (v == null || !isFinite(v) ? '–' : v.toFixed(d));
  const tierRank = (p) => (config.tiers[p.tier] ? config.tiers[p.tier].priority : 9);
  const badge = (p) => '<span class="badge ' + p.tier + '">' + (p.tier === 'none' ? 'Per match' : p.tier) + '</span>';
  const tName = (id) => (config.tournaments.find((t) => t.id === id) || { short: id }).short;

  function store(k, v) { try { localStorage.setItem('tbf.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function recall(k, d) { try { const v = localStorage.getItem('tbf.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }

  async function load(path) {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(path + ': ' + r.status);
    return r.json();
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    try {
      [config, { players }, season] = await Promise.all([load('data/config.json'), load('data/players.json'), load('data/season.json')]);
    } catch (e) {
      document.querySelector('main').innerHTML = '<div class="card empty"><strong>Could not load data</strong>' + esc(e.message) + '</div>';
      return;
    }
    if (config.logo) $('crest').src = config.logo;
    $('eyebrow').textContent = 'Season ' + config.season + ' · ' + config.tournaments.map((t) => t.name).join(' & ');
    $('cap-full').textContent = config.tiers.full.cap;
    $('cap-half').textContent = config.tiers.half.cap;
    $('total-matches').textContent = config.totalMatches;
    $('updated').textContent = season.generatedAt ? 'Updated ' + new Date(season.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'No matches parsed yet';

    state.showNone = recall('showNone', false);
    state.tournament = recall('tournament', 'all');
    if (state.tournament !== 'all' && !config.tournaments.some((t) => t.id === state.tournament)) state.tournament = 'all';
    $('show-none').checked = state.showNone;

    const seg = $('tournament-filter');
    seg.innerHTML = [{ id: 'all', short: 'All' }].concat(config.tournaments).map((t) =>
      '<button type="button" data-t="' + esc(t.id) + '" title="' + esc(t.name || 'All tournaments') + '">' + esc(t.short) + '</button>').join('');
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.tournament = b.dataset.t;
      store('tournament', state.tournament);
      render();
    });
    $('show-none').addEventListener('change', (e) => { state.showNone = e.target.checked; store('showNone', state.showNone); render(); });
    $('workload-mode').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.workload = b.dataset.mode;
      [...$('workload-mode').children].forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderWorkload(S.aggregate(season, players, state.tournament));
    });
    spyOnSections();
    render();
  }

  function visible(L) {
    if (L.player.tier === 'none') return state.showNone && L.matches > 0;
    return true;
  }

  function render() {
    [...$('tournament-filter').children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === state.tournament)));
    const agg = S.aggregate(season, players, state.tournament);
    renderKpis(agg);
    renderPlanner();
    renderQuota(agg);
    renderBatting(agg);
    renderBowling(agg);
    renderWorkload(agg);
    renderMatches(agg);
  }

  // ---------------------------------------------------------------- KPIs
  function renderKpis(agg) {
    const all = agg.allMatches.length;
    const per = config.tournaments.map((t) => ({ t, n: agg.allMatches.filter((m) => m.tournament === t.id).length }));
    let runs = 0, wkts = 0, balls = 0;
    agg.lines.forEach((L) => { runs += L.bat.runs; wkts += L.bowl.wickets; balls += L.bat.balls; });
    const wins = agg.matches.filter((m) => /won/i.test(m.result || '') && config.teamAliases.some((a) => (m.result || '').toLowerCase().includes(a.toLowerCase()))).length;
    const pct = Math.min(100, (all * 100) / config.totalMatches);
    const k = (v, l, extra) => '<div class="kpi"><div class="v num">' + v + '</div><div class="l">' + l + '</div>' + (extra || '') + '</div>';
    $('kpis').innerHTML =
      k(all + '<small> / ' + config.totalMatches + '</small>', 'Matches played', '<div class="meter"><i style="width:' + pct + '%"></i></div>') +
      per.map((x) => k(x.n, esc(x.t.name))).join('') +
      k(agg.matches.length ? wins + '<small> / ' + agg.matches.length + '</small>' : '–', 'Wins' + (state.tournament === 'all' ? '' : ' · ' + tName(state.tournament))) +
      k(runs, 'Runs off the bat') +
      k(wkts, 'Wickets');
  }

  // ---------------------------------------------------------------- quota
  function renderPlanner() {
    const P = S.plan(season, players, config);
    const pc = (n) => ((n * 100) / P.totalSlots).toFixed(2) + '%';
    const free = Math.max(0, P.totalSlots - P.slotsUsed);
    let call;
    if (P.played === 0) {
      call = P.entitlement > P.totalSlots
        ? '<div class="callout warn"><strong>Over-subscribed by ' + (P.entitlement - P.totalSlots) + ' slots</strong>Member caps add up to ' + P.entitlement + ' places, but ' + P.total + ' matches × ' + P.per + ' players is only ' + P.totalSlots + '. Rotate early so nobody falls behind.</div>'
        : '<div class="callout ok"><strong>Room for everyone</strong>Member caps (' + P.entitlement + ') fit inside the ' + P.totalSlots + ' places available.</div>';
    } else if (P.squeeze > 0) {
      call = '<div class="callout warn"><strong>' + P.squeeze + ' places short</strong>Members still need ' + P.remainingEntitlement + ' games between them, but only ' + P.remainingSlots + ' places are left in the remaining ' + P.remainingMatches + ' matches. Pick from players marked “Due a game” first.</div>';
    } else {
      call = '<div class="callout ok"><strong>' + (-P.squeeze) + ' spare places</strong>Members need ' + P.remainingEntitlement + ' more games and there are ' + P.remainingSlots + ' places left, which leaves room for per-match players.</div>';
    }
    $('planner').innerHTML =
      '<div class="card planner"><div><h3>Season places · ' + P.totalSlots + '</h3>' +
      '<div class="stack" role="img" aria-label="' + P.slotsMembers + ' member places used, ' + P.slotsGuests + ' per-match places used, ' + free + ' places left">' +
      '<i style="width:' + pc(P.slotsMembers) + ';background:var(--blue-600)"></i><i style="width:' + pc(P.slotsGuests) + ';background:var(--blue-300)"></i></div>' +
      '<div class="legend"><span><i class="dot" style="background:var(--blue-600)"></i>Members <b>' + P.slotsMembers + '</b></span>' +
      '<span><i class="dot" style="background:var(--blue-300)"></i>Per match &amp; guests <b>' + P.slotsGuests + '</b></span>' +
      '<span><i class="dot" style="background:var(--surface-2);border:1px solid var(--border)"></i>Still to play <b>' + free + '</b></span>' +
      '<span>Member caps <b>' + P.entitlement + '</b></span></div></div><div>' + call + '</div></div>';
  }

  function renderQuota(agg) {
    const teamPlayed = agg.allMatches.length;
    const rows = [...agg.lines.values()]
      .filter((L) => L.player.tier !== 'none' || (state.showNone && L.matchesAll > 0))
      .map((L) => ({ L, cap: config.tiers[L.player.tier].cap, pace: S.pace(L.matchesAll, config.tiers[L.player.tier].cap, teamPlayed, config.totalMatches) }))
      .sort((a, b) => tierRank(a.L.player) - tierRank(b.L.player) ||
        (a.pace && b.pace ? (a.L.matchesAll - a.pace.expected) - (b.L.matchesAll - b.pace.expected) : 0) ||
        b.L.matchesAll - a.L.matchesAll || fullName(a.L.player).localeCompare(fullName(b.L.player)));
    $('quota').innerHTML = rows.map(({ L, cap, pace }) => {
      const p = L.player;
      const pct = cap ? Math.min(100, (L.matchesAll * 100) / cap) : 0;
      const tick = pace ? '<span class="pace" style="left:calc(' + Math.min(100, (pace.expected * 100) / cap) + '% - 1px)" title="Expected by now: ' + pace.expected.toFixed(1) + '"></span>' : '';
      return '<div class="card qcard">' +
        '<div class="top"><span class="name" title="' + esc(fullName(p)) + '">' + esc(fullName(p)) + '</span>' + badge(p) + '</div>' +
        '<div class="count"><span class="big num">' + L.matchesAll + '</span><span class="of">' + (cap ? 'of ' + cap + ' matches' : 'matches (no cap)') + '</span></div>' +
        (cap ? '<div class="qbar"><i style="width:' + pct + '%"></i>' + tick + '</div>' : '') +
        '<div class="foot">' + (pace ? '<span class="status ' + pace.status + '">' + pace.label + '</span><span>' + pace.remaining + ' left</span>' : '<span>Pays per match</span><span></span>') + '</div>' +
        '<div class="mini"><span>Faced <b>' + L.bat.balls + '</b></span><span>Bowled <b>' + L.bowl.balls + '</b></span><span>Batted <b>' + L.bat.inns + '×</b></span></div>' +
        '</div>';
    }).join('');
  }

  // ---------------------------------------------------------------- tables
  function table(kind, cols, rows) {
    const sort = state.sort[kind];
    const col = cols.find((c) => c.key === sort.key) || cols[0];
    rows.sort((a, b) => {
      const va = col.val(a), vb = col.val(b);
      if (typeof va === 'string') return sort.dir * va.localeCompare(vb);
      return sort.dir * ((va == null ? -Infinity : va) - (vb == null ? -Infinity : vb)) || tierRank(a.player) - tierRank(b.player);
    });
    if (!rows.length) return '<div class="empty"><strong>No players to show</strong>Turn on per-match players or parse a match.</div>';
    const head = '<thead><tr>' + cols.map((c) =>
      '<th scope="col" data-key="' + c.key + '"' + (c.key === sort.key ? ' aria-sort="' + (sort.dir < 0 ? 'descending' : 'ascending') + '"' : '') + ' title="' + esc(c.title || c.label) + '">' + c.label + '</th>').join('') + '</tr></thead>';
    const body = '<tbody>' + rows.map((r) => '<tr>' + cols.map((c) => {
      const html = c.render ? c.render(r) : c.val(r);
      const isZero = html === 0 || html === '0' || html === '–';
      return c.key === 'name' ? '<td class="player">' + html + '</td>' : '<td class="num' + (c.key === sort.key ? ' hl' : '') + (isZero ? ' zero' : '') + '">' + html + '</td>';
    }).join('') + '</tr>').join('') + '</tbody>';
    return '<table class="stats">' + head + body + '</table>';
  }

  function bindSort(el, kind, rerender) {
    el.onclick = (e) => {
      const th = e.target.closest('th[data-key]');
      if (!th) return;
      const s = state.sort[kind];
      if (s.key === th.dataset.key) s.dir *= -1;
      else { s.key = th.dataset.key; s.dir = th.dataset.key === 'name' ? 1 : -1; }
      rerender();
    };
  }

  const nameCol = { key: 'name', label: 'Player', val: (L) => fullName(L.player), render: (L) => '<span class="pc">' + esc(short(L.player)) + ' ' + badge(L.player) + '</span>' };
  const mCol = { key: 'm', label: 'M', title: 'Matches played', val: (L) => L.matches };

  function renderBatting(agg) {
    const rows = [...agg.lines.values()].filter(visible);
    const maxBalls = Math.max(1, ...rows.map((L) => L.bat.balls));
    const cols = [
      nameCol, mCol,
      { key: 'inns', label: 'Opp', title: 'Batting opportunities (innings batted)', val: (L) => L.bat.inns },
      { key: 'opp', label: 'Opp %', title: 'Batted in this % of matches played', val: (L) => L.bat.oppPct, render: (L) => (L.bat.oppPct == null ? '–' : Math.round(L.bat.oppPct) + '%') },
      { key: 'runs', label: 'Runs', val: (L) => L.bat.runs },
      { key: 'balls', label: 'Balls', title: 'Balls faced', val: (L) => L.bat.balls, render: (L) => '<span class="cellbar"><i style="width:' + Math.round((L.bat.balls * 60) / maxBalls) + 'px"></i>' + L.bat.balls + '</span>' },
      { key: 'bpm', label: 'Balls/M', title: 'Balls faced per match played', val: (L) => L.bat.ballsPerMatch, render: (L) => fixed(L.bat.ballsPerMatch, 1) },
      { key: 'sr', label: 'SR', title: 'Strike rate', val: (L) => L.bat.sr, render: (L) => fixed(L.bat.sr, 1) },
      { key: 'avg', label: 'Avg', val: (L) => L.bat.avg, render: (L) => fixed(L.bat.avg, 1) },
      { key: 'hs', label: 'HS', title: 'Highest score', val: (L) => L.bat.hs, render: (L) => (L.bat.inns ? L.bat.hs + (L.bat.hsNotOut ? '*' : '') : '–') },
      { key: 'no', label: 'NO', title: 'Not outs', val: (L) => L.bat.notOuts },
      { key: 'b4', label: '4s', val: (L) => L.bat.fours },
      { key: 'b6', label: '6s', val: (L) => L.bat.sixes },
      { key: 'pos', label: 'Avg pos', title: 'Average batting position', val: (L) => L.bat.avgPos, render: (L) => fixed(L.bat.avgPos, 1) },
    ];
    const el = $('batting-table');
    el.innerHTML = table('batting', cols, rows);
    bindSort(el, 'batting', () => renderBatting(agg));
  }

  function renderBowling(agg) {
    const bpo = config.ballsPerOver;
    const rows = [...agg.lines.values()].filter(visible);
    const maxBalls = Math.max(1, ...rows.map((L) => L.bowl.balls));
    const cols = [
      nameCol, mCol,
      { key: 'inns', label: 'Opp', title: 'Bowling opportunities (matches bowled in)', val: (L) => L.bowl.inns },
      { key: 'opp', label: 'Opp %', title: 'Bowled in this % of matches played', val: (L) => L.bowl.oppPct, render: (L) => (L.bowl.oppPct == null ? '–' : Math.round(L.bowl.oppPct) + '%') },
      { key: 'overs', label: 'Overs', val: (L) => L.bowl.balls, render: (L) => (L.bowl.balls ? S.fmtOvers(L.bowl.balls, bpo) : '–') },
      { key: 'balls', label: 'Balls', title: 'Legal balls bowled', val: (L) => L.bowl.balls, render: (L) => '<span class="cellbar bowl"><i style="width:' + Math.round((L.bowl.balls * 60) / maxBalls) + 'px"></i>' + L.bowl.balls + '</span>' },
      { key: 'bpm', label: 'Balls/M', title: 'Balls bowled per match played', val: (L) => L.bowl.ballsPerMatch, render: (L) => fixed(L.bowl.ballsPerMatch, 1) },
      { key: 'wkts', label: 'Wkts', val: (L) => L.bowl.wickets },
      { key: 'runs', label: 'Runs', title: 'Runs conceded', val: (L) => L.bowl.runs },
      { key: 'econ', label: 'Econ', val: (L) => (L.bowl.econ == null ? null : -L.bowl.econ), render: (L) => fixed(L.bowl.econ, 2), title: 'Economy (sorts best first)' },
      { key: 'avg', label: 'Avg', val: (L) => (L.bowl.avg == null ? null : -L.bowl.avg), render: (L) => fixed(L.bowl.avg, 1), title: 'Bowling average (sorts best first)' },
      { key: 'best', label: 'Best', val: (L) => (L.bowl.best ? L.bowl.best.w * 1000 - L.bowl.best.r : null), render: (L) => (L.bowl.best ? L.bowl.best.w + '/' + L.bowl.best.r : '–') },
      { key: 'extras', label: 'Wd/Nb', title: 'Wides / no-balls', val: (L) => L.bowl.wides + L.bowl.noballs, render: (L) => L.bowl.wides + '/' + L.bowl.noballs },
    ];
    const el = $('bowling-table');
    el.innerHTML = table('bowling', cols, rows);
    bindSort(el, 'bowling', () => renderBowling(agg));
  }

  // ---------------------------------------------------------------- workload
  function renderWorkload(agg) {
    const per = state.workload === 'per';
    const rows = [...agg.lines.values()].filter((L) => visible(L) && L.matches > 0)
      .map((L) => ({ L, bat: per ? L.bat.ballsPerMatch : L.bat.balls, bowl: per ? L.bowl.ballsPerMatch : L.bowl.balls }))
      .sort((a, b) => (b.bat + b.bowl) - (a.bat + a.bowl));
    if (!rows.length) {
      $('workload-chart').innerHTML = '<div class="empty"><strong>No cricket yet</strong>Once a match is parsed you will see who is getting overs and who is getting time at the crease.</div>';
      return;
    }
    const max = Math.max(1, ...rows.map((r) => Math.max(r.bat, r.bowl)));
    const n = (v) => (per ? v.toFixed(1) : String(v));
    const avgBat = rows.reduce((s, r) => s + r.bat, 0) / rows.length;
    const avgBowl = rows.reduce((s, r) => s + r.bowl, 0) / rows.length;
    $('workload-chart').innerHTML =
      '<div class="wl-head"><span class="l">◂ Balls faced</span><span style="text-align:center">Player</span><span>Balls bowled ▸</span></div>' +
      rows.map((r) =>
        '<div class="wl-row">' +
        '<div class="wl-side l"><i style="width:' + (r.bat * 100) / max + '%"></i><span>' + n(r.bat) + '</span></div>' +
        '<div class="who">' + esc(short(r.L.player)) + '<small>' + r.L.matches + ' M · ' + (r.L.player.tier === 'none' ? 'per match' : r.L.player.tier) + '</small></div>' +
        '<div class="wl-side r"><i style="width:' + (r.bowl * 100) / max + '%"></i><span>' + n(r.bowl) + '</span></div>' +
        '</div>').join('') +
      '<p class="wl-note">Squad average: ' + n(per ? avgBat : Math.round(avgBat)) + ' balls faced and ' + n(per ? avgBowl : Math.round(avgBowl)) + ' balls bowled ' + (per ? 'per match' : 'per player') + '.</p>';
  }

  // ---------------------------------------------------------------- matches
  function renderMatches(agg) {
    const list = agg.matches.slice().reverse();
    if (!list.length) {
      $('match-list').innerHTML = '<div class="card empty" style="grid-column:1/-1"><strong>No matches yet</strong>The admin adds each match from its CricClubs link, and the stats appear here a minute later.</div>';
      return;
    }
    const byId = new Map(players.map((p) => [p.id, p]));
    const who = (r) => { const p = byId.get(r.playerId); return esc(p ? short(p) : r.name); };
    const aliases = config.teamAliases.map((a) => a.toLowerCase());
    $('match-list').innerHTML = list.map((m) => {
      const ours = m.players.filter((r) => r.playerId || r.name);
      const topBat = ours.filter((r) => r.bat).sort((a, b) => b.bat.runs - a.bat.runs || a.bat.balls - b.bat.balls)[0];
      const topBowl = ours.filter((r) => r.bowl && r.bowl.balls).sort((a, b) => b.bowl.wickets - a.bowl.wickets || a.bowl.runs - b.bowl.runs)[0];
      const res = m.result || '';
      const won = /won|beat/i.test(res) && aliases.some((a) => res.toLowerCase().includes(a));
      const lost = /won|beat/i.test(res) && !won;
      const date = m.date ? new Date(m.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unknown';
      return '<article class="card mcard">' +
        '<div class="row1"><span>' + esc(date) + '</span><span class="tbadge ' + esc(m.tournament) + '">' + esc(tName(m.tournament)) + '</span></div>' +
        '<div class="vs"><span>vs</span> ' + esc(m.opponent || 'Opponent') + '</div>' +
        (res ? '<div class="res ' + (won ? 'win' : lost ? 'loss' : '') + '">' + esc(res) + '</div>' : '') +
        '<div class="perf">' +
        '<div><small>Top bat</small>' + (topBat ? who(topBat) + ' · <b class="num">' + topBat.bat.runs + (topBat.bat.notOut ? '*' : '') + '</b> (' + topBat.bat.balls + ')' : '–') + '</div>' +
        '<div><small>Top bowl</small>' + (topBowl ? who(topBowl) + ' · <b class="num">' + topBowl.bowl.wickets + '/' + topBowl.bowl.runs + '</b> (' + esc(topBowl.bowl.overs) + ')' : '–') + '</div>' +
        '</div>' +
        '<div class="links"><span class="muted">' + new Set(ours.map((r) => r.playerId || r.name)).size + ' players</span>' +
        '<a href="' + esc(m.scorecardUrl) + '" target="_blank" rel="noopener">Scorecard ↗</a>' +
        '<a href="' + esc(m.ballByBallUrl) + '" target="_blank" rel="noopener">Ball by ball ↗</a></div>' +
        '</article>';
    }).join('');
  }

  // ---------------------------------------------------------------- nav highlight
  function spyOnSections() {
    const links = [...document.querySelectorAll('.sections a')];
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('main section').forEach((s) => io.observe(s));
  }

  boot();
})();
