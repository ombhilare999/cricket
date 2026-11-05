// Pure aggregation helpers for the stats page.
(function (root) {
  'use strict';

  function fmtOvers(balls, bpo) {
    return Math.floor(balls / bpo) + (balls % bpo ? '.' + (balls % bpo) : '');
  }

  function emptyLine(player) {
    return {
      player: player,
      matches: 0,
      matchesAll: 0,
      bat: { inns: 0, runs: 0, balls: 0, outs: 0, notOuts: 0, fours: 0, sixes: 0, hs: 0, hsNotOut: false, posSum: 0, fifties: 0, ducks: 0 },
      bowl: { inns: 0, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noballs: 0, dots: 0, best: null },
    };
  }

  /**
   * Aggregate a season.
   * @param {object} season  data/season.json
   * @param {object[]} players data/players.json .players
   * @param {string} tournament 'all' or a tournament id (stats only; matchesAll is always season-wide)
   */
  function aggregate(season, players, tournament) {
    const lines = new Map(players.map(function (p) { return [p.id, emptyLine(p)]; }));
    const matches = season.matches || [];
    const filtered = matches.filter(function (m) { return tournament === 'all' || m.tournament === tournament; });

    matches.forEach(function (m) {
      const seen = new Set();
      m.players.forEach(function (r) {
        if (r.playerId && lines.has(r.playerId) && !seen.has(r.playerId)) {
          seen.add(r.playerId);
          lines.get(r.playerId).matchesAll += 1;
        }
      });
    });

    filtered.forEach(function (m) {
      const seen = new Set();
      m.players.forEach(function (r) {
        const L = r.playerId && lines.get(r.playerId);
        if (!L) return;
        if (!seen.has(r.playerId)) { seen.add(r.playerId); L.matches += 1; }
        if (r.batted && r.bat) {
          const b = L.bat, s = r.bat;
          b.inns += 1; b.runs += s.runs; b.balls += s.balls; b.fours += s.fours || 0; b.sixes += s.sixes || 0;
          if (s.notOut) b.notOuts += 1; else b.outs += 1;
          if (s.pos) b.posSum += s.pos;
          if (s.runs > b.hs || (s.runs === b.hs && s.notOut)) { b.hs = s.runs; b.hsNotOut = !!s.notOut; }
          if (s.runs >= 50) b.fifties += 1;
          if (s.runs === 0 && !s.notOut) b.ducks += 1;
        }
        if (r.bowl && r.bowl.balls > 0) {
          const w = L.bowl, s = r.bowl;
          w.inns += 1; w.balls += s.balls; w.runs += s.runs; w.wickets += s.wickets;
          w.maidens += s.maidens || 0; w.wides += s.wides || 0; w.noballs += s.noballs || 0; w.dots += s.dots || 0;
          if (!w.best || s.wickets > w.best.w || (s.wickets === w.best.w && s.runs < w.best.r)) w.best = { w: s.wickets, r: s.runs };
        }
      });
    });

    lines.forEach(function (L) {
      const b = L.bat, w = L.bowl;
      b.sr = b.balls ? (b.runs * 100) / b.balls : null;
      b.avg = b.outs ? b.runs / b.outs : null;
      b.oppPct = L.matches ? (b.inns * 100) / L.matches : null;
      b.ballsPerMatch = L.matches ? b.balls / L.matches : null;
      b.avgPos = b.inns ? b.posSum / b.inns : null;
      w.econ = w.balls ? (w.runs * 6) / w.balls : null;
      w.avg = w.wickets ? w.runs / w.wickets : null;
      w.sr = w.wickets ? w.balls / w.wickets : null;
      w.oppPct = L.matches ? (w.inns * 100) / L.matches : null;
      w.ballsPerMatch = L.matches ? w.balls / L.matches : null;
    });

    return { lines: lines, matches: filtered, allMatches: matches };
  }

  /** Season-wide slot maths for the quota planner. */
  function plan(season, players, config) {
    const total = config.totalMatches;
    const per = config.playersPerSide;
    const played = (season.matches || []).length;
    const counts = new Map(players.map(function (p) { return [p.id, 0]; }));
    let slotsUsed = 0, slotsMembers = 0, slotsGuests = 0;
    (season.matches || []).forEach(function (m) {
      const seen = new Set();
      m.players.forEach(function (r) {
        const key = r.playerId || 'guest:' + r.name;
        if (seen.has(key)) return;
        seen.add(key);
        slotsUsed += 1;
        const p = r.playerId && players.find(function (x) { return x.id === r.playerId; });
        if (p && p.tier !== 'none') { slotsMembers += 1; counts.set(p.id, counts.get(p.id) + 1); }
        else slotsGuests += 1;
      });
    });
    let entitlement = 0, remainingEntitlement = 0;
    players.forEach(function (p) {
      const cap = config.tiers[p.tier] && config.tiers[p.tier].cap;
      if (!cap) return;
      entitlement += cap;
      remainingEntitlement += Math.max(0, cap - counts.get(p.id));
    });
    const remainingMatches = Math.max(0, total - played);
    const remainingSlots = remainingMatches * per;
    return {
      total: total, played: played, per: per, totalSlots: total * per,
      slotsUsed: slotsUsed, slotsMembers: slotsMembers, slotsGuests: slotsGuests,
      entitlement: entitlement, remainingEntitlement: remainingEntitlement,
      remainingMatches: remainingMatches, remainingSlots: remainingSlots,
      squeeze: remainingEntitlement - remainingSlots,
    };
  }

  /** Where a capped player should be by now, given team progress. */
  function pace(played, cap, teamPlayed, total) {
    if (!cap) return null;
    const expected = (cap * teamPlayed) / total;
    const remainingMatches = total - teamPlayed;
    const needed = cap - played;
    let status = 'ok', label = 'On track';
    if (played >= cap) { status = 'cap'; label = 'Cap reached'; }
    else if (needed > remainingMatches) { status = 'over'; label = "Can't reach cap"; }
    else if (played < expected - 1) { status = 'due'; label = 'Due a game'; }
    else if (played > expected + 1) { status = 'ok'; label = 'Ahead'; }
    return { expected: expected, status: status, label: label, remaining: Math.max(0, needed) };
  }

  root.TBFStats = { aggregate: aggregate, plan: plan, pace: pace, fmtOvers: fmtOvers };
})(typeof window !== 'undefined' ? window : globalThis);
