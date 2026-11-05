#!/usr/bin/env node
// Rebuild data/season.json from data/matches/*.json and the current roster.
// After adding an alias to data/players.json, run `npm run build-season` and old matches pick it up.
// (The deploy workflow runs this on every push too.)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeason as build } from '../assets/js/lib/season.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

export function buildSeason() {
  const { players } = readJson('data/players.json');
  const files = readdirSync(join(ROOT, 'data/matches')).filter((f) => f.endsWith('.json'));
  const season = build(files.map((f) => readJson(`data/matches/${f}`)), players);
  writeFileSync(join(ROOT, 'data/season.json'), JSON.stringify(season, null, 1) + '\n');
  return season;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = buildSeason();
  console.log(`season.json: ${s.matches.length} matches, ${s.unmatchedNames.length} unmatched names${s.unmatchedNames.length ? ': ' + s.unmatchedNames.join(', ') : ''}`);
}
