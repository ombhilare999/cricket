#!/usr/bin/env node
// Add one match from its CricClubs full scorecard.
//
//   node scripts/ingest.mjs --url "https://cricclubs.com/<League>/fullScorecard.do?clubId=..&matchId=.."
//
// Normally matches are added from the admin page (/cricket/admin/). CricClubs blocks most
// automated downloads, so from the command line pass a page saved from your browser.
//
// Options:
//   --tournament auto|lakeshore|mcl   default: detect from the league in the link
//   --scorecard-html file.html        use a saved page instead of downloading
//   --reparse                         re-read the raw page saved in data/raw/ (CLI only)
//   --result file.md                  write a human-readable result
//
// Exit codes: 0 added, 2 rejected (bad link, wrong team, unknown players), 3 already added,
// 4 download/parse failure.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseMatchUrl, detectTournament, buildMatch, RejectedMatch } from '../assets/js/lib/match.js';
import { slimHtml as slim } from '../assets/js/lib/season.js';
import { htmlToDoc } from './lib/dom.mjs';
import { buildSeason } from './build-season.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    tournament: { type: 'string', default: 'auto' },
    'scorecard-html': { type: 'string' },
    reparse: { type: 'boolean', default: false },
    result: { type: 'string' },
  },
});

function report(text) {
  console.log(text);
  if (args.result) writeFileSync(args.result, text + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n', { flag: 'a' });
}

function fail(code, msg) {
  console.error(`::error::${msg}`);
  report(`### ❌ Match not added\n\n${msg}`);
  process.exit(code);
}

async function download(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`CricClubs returned HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const link = args.url;
  if (!link) fail(2, 'No CricClubs full scorecard link found. It should look like https://cricclubs.com/MississaugaCricketLeague/fullScorecard.do?clubId=2565&matchId=8556');

  let info;
  try {
    info = parseMatchUrl(link);
  } catch (e) {
    fail(2, e.message);
  }
  const config = readJson('data/config.json');
  const { players } = readJson('data/players.json');

  const matchPath = join(ROOT, 'data/matches', `${info.id}.json`);
  if (existsSync(matchPath) && !args.reparse) fail(3, `Match ${info.matchId} (${info.league}) has already been added. Each match can only be added once.`);

  const tournament = args.tournament && args.tournament !== 'auto' ? args.tournament : detectTournament(info.league, config);
  if (!tournament || !config.tournaments.some((t) => t.id === tournament)) {
    fail(2, `"${info.league}" is not one of our tournaments (${config.tournaments.map((t) => t.name).join(', ')}).`);
  }

  const rawDir = join(ROOT, 'data/raw');
  mkdirSync(rawDir, { recursive: true });
  const rawPath = join(rawDir, `${info.id}.scorecard.html`);

  let html;
  try {
    if (args.reparse) html = readFileSync(rawPath, 'utf8');
    else if (args['scorecard-html']) html = readFileSync(args['scorecard-html'], 'utf8');
    else html = await download(info.scorecardUrl);
  } catch (e) {
    fail(4, `Could not get the scorecard: ${e.message}`);
  }

  let parsed;
  try {
    parsed = buildMatch({ doc: htmlToDoc(html), players, config });
  } catch (e) {
    if (e instanceof RejectedMatch) fail(2, e.message);
    fail(4, `Could not read the scorecard: ${e.message}`);
  }

  writeFileSync(rawPath, slim(html));
  const prev = existsSync(matchPath) ? JSON.parse(readFileSync(matchPath, 'utf8')) : {};
  const record = {
    id: info.id,
    matchId: info.matchId,
    clubId: info.clubId,
    league: info.league,
    tournament,
    scorecardUrl: info.scorecardUrl,
    parsedAt: prev.parsedAt || new Date().toISOString(),
    ...parsed,
    ...(prev.extraPlayers ? { extraPlayers: prev.extraPlayers } : {}),
    ...(prev.dateOverride ? { date: prev.dateOverride, dateOverride: prev.dateOverride } : {}),
  };
  writeFileSync(matchPath, JSON.stringify(record, null, 1) + '\n');
  buildSeason();

  const tName = config.tournaments.find((t) => t.id === tournament).name;
  report(
    [
      `### ✅ Added: ${config.teamName} vs ${record.opponent || 'opponent'}`,
      '',
      `${tName} · ${record.date || 'date unknown'}${record.result ? ` · ${record.result}` : ''}`,
      '',
      '| Player | Batting (R/B) | Bowling (O-R-W) |',
      '|---|---|---|',
      ...record.players.map((p) => `| ${p.name} | ${p.bat ? `${p.bat.runs}${p.bat.notOut ? '*' : ''} (${p.bat.balls})` : '–'} | ${p.bowl ? `${p.bowl.overs}-${p.bowl.runs}-${p.bowl.wickets}` : '–'} |`),
      '',
      ...record.notes.map((n) => `> ${n}`),
      'The stats page updates in about a minute.',
    ].join('\n'),
  );
}

main();
