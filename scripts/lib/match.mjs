// Turns parsed CricClubs pages into one match record for our team.

import { buildMatcher, norm } from './names.mjs';
import { parseScorecard, parseBallByBall } from './parse.mjs';

/** Pull league / clubId / matchId out of any CricClubs match URL. */
export function parseMatchUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    throw new Error('That is not a valid URL.');
  }
  if (!/(^|\.)cricclubs\.com$/i.test(u.hostname)) throw new Error('URL must be on cricclubs.com');
  const league = u.pathname.split('/').filter(Boolean)[0];
  const q = Object.fromEntries([...u.searchParams].map(([k, v]) => [k.toLowerCase(), v]));
  const matchId = q.matchid;
  const clubId = q.clubid;
  if (!league || !/^[A-Za-z0-9_-]+$/.test(league)) throw new Error('Could not find the league name in the URL path.');
  if (!/^\d+$/.test(matchId || '')) throw new Error('URL must contain matchId=<number>.');
  if (clubId && !/^\d+$/.test(clubId)) throw new Error('clubId must be a number.');
  const base = `https://cricclubs.com/${league}`;
  const qs = `matchId=${matchId}${clubId ? `&clubId=${clubId}` : ''}`;
  return {
    league,
    matchId: Number(matchId),
    clubId: clubId ? Number(clubId) : null,
    id: `${league.toLowerCase()}-${matchId}`,
    ballByBallUrl: `${base}/ballbyball.do?${qs}`,
    scorecardUrl: `${base}/viewScorecard.do?${qs}`,
  };
}

export function detectTournament(league, config) {
  const l = league.toLowerCase();
  const t = config.tournaments.find((t) => t.urlKeywords.some((k) => l.includes(k)));
  return t ? t.id : null;
}

/** Pick the card whose names match the most roster players. */
function bestCard(cards, getNames, matcher) {
  let best = null;
  let bestScore = 0;
  for (const card of cards) {
    const score = getNames(card).filter((n) => matcher(n)).length;
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Build a match record from raw HTML.
 * Player rows keep the raw CricClubs name; roster ids are resolved again at
 * build-season time, so adding an alias later fixes old matches too.
 */
export function buildMatch({ scorecardHtml, ballByBallHtml, players, config }) {
  const matcher = buildMatcher(players);
  const bpo = config.ballsPerOver || 6;
  let batters = [];
  let bowlers = [];
  let dnb = [];
  let meta = {};
  let source = null;
  const notes = [];

  if (scorecardHtml) {
    const sc = parseScorecard(scorecardHtml, { ballsPerOver: bpo });
    meta = sc.meta;
    const bat = bestCard(sc.battingCards, (c) => [...c.batters.map((b) => b.name), ...c.dnb], matcher);
    const bowl = bestCard(sc.bowlingCards, (c) => c.map((b) => b.name), matcher);
    if (bat || bowl) {
      source = 'scorecard';
      batters = bat ? bat.batters : [];
      dnb = [...(bat ? bat.dnb : []), ...sc.looseDnb.filter((n) => matcher(n))];
      bowlers = bowl || [];
    } else notes.push(`scorecard: no batting/bowling card matched the roster (${sc.battingCards.length} batting, ${sc.bowlingCards.length} bowling cards found)`);
  }

  if (!source && ballByBallHtml) {
    const bb = parseBallByBall(ballByBallHtml, { ballsPerOver: bpo });
    if (!meta.title) meta = bb.meta;
    const batInn = bestCard(bb.innings, (i) => i.batters.map((b) => b.name), matcher);
    const bowlInn = bestCard(bb.innings, (i) => i.bowlers.map((b) => b.name), matcher);
    if (batInn || bowlInn) {
      source = 'ballbyball';
      batters = batInn ? batInn.batters : [];
      bowlers = bowlInn ? bowlInn.bowlers : [];
      notes.push('ball-by-ball fallback: players who were in the XI but neither batted nor bowled are not detected');
    } else notes.push(`ball-by-ball: no innings matched the roster (${bb.innings.length} innings found)`);
  }

  if (!source) {
    const err = new Error(`Could not find True Blue Falcons players on the page. ${notes.join('; ')}`);
    err.notes = notes;
    throw err;
  }

  // merge into one row per player
  const rows = new Map();
  const row = (name) => {
    const k = norm(name);
    if (!rows.has(k)) rows.set(k, { name, batted: false, bowled: false });
    return rows.get(k);
  };
  for (const b of batters) Object.assign(row(b.name), { batted: true, bat: { pos: b.pos, runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, notOut: b.notOut, dismissal: b.dismissal } });
  for (const n of dnb) row(n);
  for (const b of bowlers) {
    const r = row(b.name);
    r.bowled = b.balls > 0;
    r.bowl = { overs: b.overs, balls: b.balls, maidens: b.maidens, runs: b.runs, wickets: b.wickets, wides: b.wides, noballs: b.noballs, dots: b.dots };
  }

  const ours = (meta.teams || []).map((t) => config.teamAliases.some((a) => norm(t).includes(norm(a))));
  const opponent = (meta.teams || []).find((_, i) => !ours[i]) || null;

  return {
    source,
    title: meta.title || null,
    date: meta.date || null,
    teams: meta.teams || [],
    opponent,
    result: meta.result || null,
    notes,
    players: [...rows.values()],
  };
}
