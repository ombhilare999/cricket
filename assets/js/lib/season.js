// Builds data/season.json from match records and the roster. Shared by the admin page
// (which commits a fresh season.json with every new match) and scripts/build-season.mjs.
// Raw CricClubs names are resolved to roster ids here, so a new alias in data/players.json
// is picked up by old matches the next time the season is rebuilt.

import { buildMatcher } from './names.js';

export function buildSeason(matchRecords, players, now = new Date()) {
  const matcher = buildMatcher(players);
  const matches = matchRecords.map((m) => JSON.parse(JSON.stringify(m)));
  const unmatched = new Set();
  for (const m of matches) {
    m.players = m.players.filter((p) => !p.manual); // re-added below from extraPlayers
    for (const p of m.players) {
      p.playerId = p.playerIdOverride || matcher(p.name);
      if (!p.playerId) unmatched.add(p.name);
    }
    // manual additions: players who were in the XI but don't appear on the card
    for (const id of m.extraPlayers || []) {
      if (!m.players.some((p) => p.playerId === id)) m.players.push({ name: id, playerId: id, batted: false, bowled: false, manual: true });
    }
  }
  matches.sort((a, b) => String(a.date || a.parsedAt).localeCompare(String(b.date || b.parsedAt)));
  return { generatedAt: now.toISOString(), unmatchedNames: [...unmatched].sort(), matches };
}

/** Keep stored raw pages small: drop scripts, styles, svg and comments. */
export function slimHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n\s*\n+/g, '\n');
}
