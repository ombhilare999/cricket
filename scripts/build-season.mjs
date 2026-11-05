#!/usr/bin/env node
// Rebuild data/season.json from data/matches/*.json and the current roster.
// Raw CricClubs names are resolved to roster ids here, so after adding an alias to
// data/players.json, run `npm run build-season` and old matches pick it up.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMatcher } from './lib/names.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

export function buildSeason() {
  const { players } = readJson('data/players.json');
  const matcher = buildMatcher(players);
  const files = readdirSync(join(ROOT, 'data/matches')).filter((f) => f.endsWith('.json'));
  const matches = files.map((f) => readJson(`data/matches/${f}`));
  const unmatched = new Set();
  for (const m of matches) {
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
  const season = { generatedAt: new Date().toISOString(), unmatchedNames: [...unmatched].sort(), matches };
  writeFileSync(join(ROOT, 'data/season.json'), JSON.stringify(season, null, 1) + '\n');
  return season;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = buildSeason();
  console.log(`season.json: ${s.matches.length} matches, ${s.unmatchedNames.length} unmatched names${s.unmatchedNames.length ? ': ' + s.unmatchedNames.join(', ') : ''}`);
}
