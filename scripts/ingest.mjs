#!/usr/bin/env node
// Ingest one CricClubs match.
//
//   node scripts/ingest.mjs --url "<cricclubs ballbyball or scorecard link>" [--tournament auto|lakeshore|mcl]
//
// Offline / re-parse options:
//   --scorecard-html file.html   use a saved scorecard page instead of downloading
//   --ballbyball-html file.html  use a saved ball-by-ball page instead of downloading
//   --reparse                    re-parse from the raw pages saved in data/raw/
//   --force                      allow overwriting an already-ingested match (CLI only;
//                                the website/admin flow never passes this)
//
// Exit codes: 0 ok, 2 bad input, 3 match already ingested, 4 fetch/parse failure.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseMatchUrl, detectTournament, buildMatch } from './lib/match.mjs';
import { buildSeason } from './build-season.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    tournament: { type: 'string', default: 'auto' },
    'scorecard-html': { type: 'string' },
    'ballbyball-html': { type: 'string' },
    reparse: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

function fail(code, msg) {
  console.error(`::error::${msg}`);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### ❌ ${msg}\n`, { flag: 'a' });
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
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.text();
}

// keep raw pages small: drop scripts, styles, svg and comments
const slim = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n\s*\n+/g, '\n');

async function main() {
  if (!args.url) fail(2, 'Missing --url');
  let info;
  try {
    info = parseMatchUrl(args.url);
  } catch (e) {
    fail(2, e.message);
  }
  const config = readJson('data/config.json');
  const { players } = readJson('data/players.json');

  const matchPath = join(ROOT, 'data/matches', `${info.id}.json`);
  if (existsSync(matchPath) && !args.force && !args.reparse) {
    fail(3, `Match ${info.matchId} (${info.league}) has already been parsed. Each match can only be ingested once.`);
  }

  let tournament = args.tournament && args.tournament !== 'auto' ? args.tournament : detectTournament(info.league, config);
  if (!tournament) fail(2, `Could not tell which tournament "${info.league}" belongs to. Pick it explicitly.`);
  if (!config.tournaments.some((t) => t.id === tournament)) fail(2, `Unknown tournament "${tournament}"`);

  const rawDir = join(ROOT, 'data/raw');
  mkdirSync(rawDir, { recursive: true });
  const rawSc = join(rawDir, `${info.id}.scorecard.html`);
  const rawBb = join(rawDir, `${info.id}.ballbyball.html`);

  let scorecardHtml = null;
  let ballByBallHtml = null;
  const errors = [];
  if (args.reparse) {
    if (existsSync(rawSc)) scorecardHtml = readFileSync(rawSc, 'utf8');
    if (existsSync(rawBb)) ballByBallHtml = readFileSync(rawBb, 'utf8');
  } else {
    if (args['scorecard-html']) scorecardHtml = readFileSync(args['scorecard-html'], 'utf8');
    if (args['ballbyball-html']) ballByBallHtml = readFileSync(args['ballbyball-html'], 'utf8');
    if (!scorecardHtml && !ballByBallHtml) {
      for (const [k, url] of [['sc', info.scorecardUrl], ['bb', info.ballByBallUrl]]) {
        try {
          const html = await download(url);
          if (k === 'sc') scorecardHtml = html;
          else ballByBallHtml = html;
        } catch (e) {
          errors.push(e.message);
        }
      }
    }
  }
  if (!scorecardHtml && !ballByBallHtml) fail(4, `Could not download the match pages: ${errors.join('; ')}`);
  if (scorecardHtml) writeFileSync(rawSc, slim(scorecardHtml));
  if (ballByBallHtml) writeFileSync(rawBb, slim(ballByBallHtml));

  let parsed;
  try {
    parsed = buildMatch({ scorecardHtml, ballByBallHtml, players, config });
  } catch (e) {
    fail(4, e.message);
  }

  const prev = existsSync(matchPath) ? JSON.parse(readFileSync(matchPath, 'utf8')) : {};
  const record = {
    id: info.id,
    matchId: info.matchId,
    clubId: info.clubId,
    league: info.league,
    tournament,
    sourceUrl: args.url,
    scorecardUrl: info.scorecardUrl,
    ballByBallUrl: info.ballByBallUrl,
    parsedAt: prev.parsedAt || new Date().toISOString(),
    ...parsed,
    // keep manual fixes across a re-parse
    ...(prev.extraPlayers ? { extraPlayers: prev.extraPlayers } : {}),
    ...(prev.dateOverride ? { date: prev.dateOverride, dateOverride: prev.dateOverride } : {}),
  };
  writeFileSync(matchPath, JSON.stringify(record, null, 1) + '\n');
  const season = buildSeason();

  const ours = season.matches.find((m) => m.id === info.id).players;
  const lines = [
    `### ✅ Parsed ${record.title || info.id}`,
    `Tournament: **${tournament}** · Source: **${record.source}** · Date: ${record.date || 'unknown'} · Opponent: ${record.opponent || 'unknown'}`,
    record.result ? `Result: ${record.result}` : '',
    '',
    '| Player | Roster match | Bat (R/B) | Bowl (O-R-W) |',
    '|---|---|---|---|',
    ...ours.map((p) => `| ${p.name} | ${p.playerId || '⚠️ not matched'} | ${p.bat ? `${p.bat.runs}/${p.bat.balls}` : '–'} | ${p.bowl ? `${p.bowl.overs}-${p.bowl.runs}-${p.bowl.wickets}` : '–'} |`),
    '',
    ...record.notes.map((n) => `> ${n}`),
  ];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
}

main();
