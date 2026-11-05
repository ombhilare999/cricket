import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMatcher } from '../scripts/lib/names.mjs';
import { parseMatchUrl, buildMatch, detectTournament } from '../scripts/lib/match.mjs';
import { classifyBall, oversToBalls } from '../scripts/lib/parse.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const { players } = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
const match = buildMatcher(players);

test('name matching', () => {
  assert.equal(match('Omkar Bhilare (c)'), 'omkar-bhilare');
  assert.equal(match('O Bhilare'), 'omkar-bhilare');
  assert.equal(match('Bhilare O'), 'omkar-bhilare');
  assert.equal(match("Alston D'Mello †"), 'alston-d-mello');
  assert.equal(match('Alston Dmello'), 'alston-d-mello');
  assert.equal(match('Hritik Advani'), 'hritik-kumar-advani');
  assert.equal(match('Mulhim Nadeem'), 'rana-mulhim-nadeem');
  assert.equal(match('J Bajwa'), 'jaideep-bajwa');
  assert.equal(match('A Naqvi'), null, 'Ali vs Asad Naqvi is ambiguous');
  assert.equal(match('S Amin'), null, 'Sadan vs Shayan Amin is ambiguous');
  assert.equal(match('Shayan Amin'), 'shayan-amin');
  assert.equal(match('Imran Ahmed'), null);
});

test('url parsing', () => {
  const u = parseMatchUrl('https://cricclubs.com/MississaugaCricketLeague/ballbyball.do?clubId=2565&matchId=8556');
  assert.equal(u.id, 'mississaugacricketleague-8556');
  assert.equal(u.scorecardUrl, 'https://cricclubs.com/MississaugaCricketLeague/viewScorecard.do?matchId=8556&clubId=2565');
  assert.equal(detectTournament(u.league, config), 'mcl');
  assert.equal(detectTournament('LakeshoreCricketLeague', config), 'lakeshore');
  assert.throws(() => parseMatchUrl('https://evil.com/x?matchId=1'));
  assert.throws(() => parseMatchUrl('https://cricclubs.com/X/ballbyball.do?clubId=1'));
});

test('overs and ball classification', () => {
  assert.equal(oversToBalls('3.4'), 22);
  assert.equal(oversToBalls('4'), 24);
  assert.deepEqual(classifyBall('wide').wide, true);
  assert.equal(classifyBall('FOUR, driven').runs, 4);
  assert.equal(classifyBall('2 runs').runs, 2);
  assert.equal(classifyBall('no run').runs, 0);
  assert.equal(classifyBall('OUT! Bowled').wicket, true);
  assert.equal(classifyBall('run out').runOut, true);
});

test('scorecard: picks our cards, reads stats, DNB and meta', () => {
  const m = buildMatch({ scorecardHtml: fx('scorecard.html'), players, config });
  assert.equal(m.source, 'scorecard');
  assert.equal(m.date, '2026-06-14');
  assert.equal(m.opponent, 'Brampton Strikers');
  assert.match(m.result, /won by 23 runs/);
  const by = Object.fromEntries(m.players.map((p) => [match(p.name) || p.name, p]));
  assert.deepEqual([by['omkar-bhilare'].bat.runs, by['omkar-bhilare'].bat.balls], [42, 31]);
  assert.equal(by['omkar-bhilare'].bowl.wickets, 2);
  assert.equal(by['alston-d-mello'].bat.notOut, true);
  assert.equal(by['jaideep-bajwa'].bat.notOut, false);
  assert.equal(by['dhruv-sardana'].bowl.balls, 22);
  assert.equal(by['dhruv-sardana'].batted, false, 'DNB but bowled');
  assert.ok(by['shailin-gosalia'], 'DNB-only player counted in XI');
  assert.ok(by['Some Guest'], 'unknown names are kept for review');
  assert.equal(by['Imran Ahmed'], undefined, 'opposition players are excluded');
  assert.equal(m.players.length, 11);
});

test('ball-by-ball fallback', () => {
  const m = buildMatch({ ballByBallHtml: fx('ballbyball.html'), players, config });
  assert.equal(m.source, 'ballbyball');
  assert.equal(m.date, '2026-07-05');
  const by = Object.fromEntries(m.players.map((p) => [match(p.name), p]));
  assert.deepEqual([by['omkar-bhilare'].bat.runs, by['omkar-bhilare'].bat.balls, by['omkar-bhilare'].bat.notOut], [1, 2, false]);
  assert.deepEqual([by['vansh-tyagi'].bat.runs, by['vansh-tyagi'].bat.balls], [4, 3]);
  assert.deepEqual([by['chirag-sethi'].bat.runs, by['chirag-sethi'].bat.balls], [8, 2]);
  assert.deepEqual([by['asad-naqvi'].bowl.balls, by['asad-naqvi'].bowl.runs, by['asad-naqvi'].bowl.wickets], [2, 2, 1]);
  assert.equal(by['ayush-aran'].bowl.runs, 4);
});
