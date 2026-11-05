// Turns a CricClubs full scorecard into one match record for our team, and
// enforces the submission rules:
//   1. the link is a cricclubs.com fullScorecard.do link with a matchId
//   2. the scorecard names our team exactly (config.teamName)
//   3. every one of our players on the card is on the roster, by exact name or alias

import { buildMatcher, norm } from './names.js';
import { parseScorecard } from './parse.js';

export class RejectedMatch extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra); // e.g. { unknown: ['Some Name'] } so the admin page can map names to the roster
  }
}

const LINK_RE = /https:\/\/(?:www\.)?cricclubs\.com\/[A-Za-z0-9_-]+\/fullScorecard\.do\?[^\s<>"')\]]+/i;

/** Find the first full-scorecard link in free text (e.g. an issue body). */
export function findScorecardLink(text) {
  const m = String(text || '').match(LINK_RE);
  return m ? m[0].replace(/&amp;/g, '&') : null;
}

/** Validate a full-scorecard link and pull out league / clubId / matchId. */
export function parseMatchUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    throw new RejectedMatch('That is not a valid link.');
  }
  if (u.protocol !== 'https:' || !/^(www\.)?cricclubs\.com$/i.test(u.hostname)) throw new RejectedMatch('The link must be on https://cricclubs.com.');
  const parts = u.pathname.split('/').filter(Boolean);
  const league = parts[0];
  if (parts.length !== 2 || parts[1].toLowerCase() !== 'fullscorecard.do') {
    throw new RejectedMatch('Use the full scorecard link, for example https://cricclubs.com/MississaugaCricketLeague/fullScorecard.do?clubId=2565&matchId=8556');
  }
  const q = Object.fromEntries([...u.searchParams].map(([k, v]) => [k.toLowerCase(), v]));
  if (!/^[A-Za-z0-9_-]+$/.test(league || '')) throw new RejectedMatch('Could not find the league name in the link.');
  if (!/^\d+$/.test(q.matchid || '')) throw new RejectedMatch('The link must contain matchId=<number>.');
  if (q.clubid && !/^\d+$/.test(q.clubid)) throw new RejectedMatch('clubId must be a number.');
  const qs = `${q.clubid ? `clubId=${q.clubid}&` : ''}matchId=${q.matchid}`;
  return {
    league,
    matchId: Number(q.matchid),
    clubId: q.clubid ? Number(q.clubid) : null,
    id: `${league.toLowerCase()}-${q.matchid}`,
    scorecardUrl: `https://cricclubs.com/${league}/fullScorecard.do?${qs}`,
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
  return { card: best, score: bestScore };
}

// "True Blue Falcons", "True Blue Falcons Innings 156/7 (20.0 ov)", "True Blue Falcons 1st Innings"
// all name the team exactly; "True Blue Falcons B" does not.
const LABEL_NOISE = /\b(innings|inning|inns|st|nd|ov|overs|batting|bowling|team)\b/g;
const isTeamLabel = (label, team) => norm(label).replace(LABEL_NOISE, ' ').replace(/\s+/g, ' ').trim() === norm(team);

/**
 * Build a match record from a parsed full scorecard page (a DOM Document), or throw
 * RejectedMatch explaining which rule failed.
 */
export function buildMatch({ doc, players, config }) {
  const matcher = buildMatcher(players);
  const sc = parseScorecard(doc, { ballsPerOver: config.ballsPerOver || 6 });

  // rule 2: our exact team name is on the scorecard
  const teamOnPage = [...(sc.meta.teams || []), ...sc.labels].some((t) => isTeamLabel(t, config.teamName));
  if (!teamOnPage) throw new RejectedMatch(`This scorecard is not a ${config.teamName} match: the team name "${config.teamName}" does not appear on it.`);
  if (!sc.battingCards.length && !sc.bowlingCards.length) throw new RejectedMatch('Could not read any batting or bowling tables on this page. Is it a full scorecard?');

  // our cards are the ones made of roster players
  const bat = bestCard(sc.battingCards, (c) => [...c.batters.map((b) => b.name), ...c.dnb], matcher);
  const bowl = bestCard(sc.bowlingCards, (c) => c.map((b) => b.name), matcher);
  if (!bat.card && !bowl.card) {
    throw new RejectedMatch(`None of the players on this scorecard are on the ${config.teamName} roster.`);
  }

  const batters = bat.card ? bat.card.batters : [];
  const dnb = [...(bat.card ? bat.card.dnb : []), ...sc.looseDnb.filter((n) => matcher(n))];
  const bowlers = bowl.card || [];

  // rule 3: every one of our players must be on the roster by exact name
  const unknown = [...new Set([...batters.map((b) => b.name), ...(bat.card ? bat.card.dnb : []), ...bowlers.map((b) => b.name)].filter((n) => !matcher(n)))];
  if (unknown.length) {
    throw new RejectedMatch(
      `These ${config.teamName} players on the scorecard are not on the roster: ${unknown.join(', ')}. ` +
        'Names must match exactly. Link each one to a roster player (it is saved as an alias) or add them as a new player.',
      { unknown },
    );
  }

  // merge into one row per player
  const rows = new Map();
  const row = (name) => {
    const id = matcher(name);
    if (!rows.has(id)) rows.set(id, { name, playerId: id, batted: false, bowled: false });
    return rows.get(id);
  };
  for (const b of batters) Object.assign(row(b.name), { batted: true, bat: { pos: b.pos, runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, notOut: b.notOut, dismissal: b.dismissal } });
  for (const n of dnb) row(n);
  for (const b of bowlers) {
    const r = row(b.name);
    r.bowled = b.balls > 0;
    r.bowl = { overs: b.overs, balls: b.balls, maidens: b.maidens, runs: b.runs, wickets: b.wickets, wides: b.wides, noballs: b.noballs, dots: b.dots };
  }

  const meta = sc.meta;
  const opponent = (meta.teams || []).find((t) => !config.teamAliases.some((a) => norm(t) === norm(a))) || null;
  const notes = [];
  if (!bat.card) notes.push('No batting card found for our team.');
  if (!bowl.card) notes.push('No bowling card found for our team.');

  return {
    source: 'scorecard',
    title: meta.title || null,
    date: meta.date || null,
    teams: meta.teams || [],
    opponent,
    result: meta.result || null,
    notes,
    players: [...rows.values()],
  };
}
