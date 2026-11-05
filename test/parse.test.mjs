import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMatcher } from '../assets/js/lib/names.js';
import { parseMatchUrl, buildMatch as build, detectTournament, findScorecardLink, RejectedMatch } from '../assets/js/lib/match.js';
import { oversToBalls } from '../assets/js/lib/parse.js';
import { buildSeason } from '../assets/js/lib/season.js';
import { htmlToDoc } from '../scripts/lib/dom.mjs';

const buildMatch = ({ scorecardHtml, ...rest }) => build({ doc: htmlToDoc(scorecardHtml), ...rest });

const fixture = readFileSync(new URL('./fixtures/scorecard.html', import.meta.url), 'utf8');
const { players } = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
const match = buildMatcher(players);

test('names match exactly, ignoring case, punctuation and (c)/(wk)/* markers', () => {
  assert.equal(match('Omkar Bhilare (c)'), 'omkar-bhilare');
  assert.equal(match('OMKAR  bhilare*'), 'omkar-bhilare');
  assert.equal(match("Alston D'Mello †"), 'alston-d-mello');
  assert.equal(match('Hritik Kumar Advani'), 'hritik-kumar-advani');
  assert.equal(match('O Bhilare'), null, 'initials are not guessed');
  assert.equal(match('Hritik Advani'), null, 'partial names are not guessed');
  assert.equal(match('Imran Ahmed'), null);
  const withAlias = buildMatcher([{ id: 'x', first: 'Hritik Kumar', last: 'Advani', aliases: ['Hritik Advani'] }]);
  assert.equal(withAlias('Hritik Advani'), 'x', 'aliases match');
});

test('only full scorecard links are accepted', () => {
  const u = parseMatchUrl('https://cricclubs.com/MississaugaCricketLeague/fullScorecard.do?clubId=2565&matchId=8556');
  assert.equal(u.id, 'mississaugacricketleague-8556');
  assert.equal(u.scorecardUrl, 'https://cricclubs.com/MississaugaCricketLeague/fullScorecard.do?clubId=2565&matchId=8556');
  assert.equal(detectTournament(u.league, config), 'mcl');
  assert.equal(detectTournament('LakeshoreCricketLeague', config), 'lakeshore');
  const www = parseMatchUrl('https://www.cricclubs.com/MississaugaCricketLeague/fullScorecard.do?matchId=8556&clubId=2565');
  assert.equal(www.id, 'mississaugacricketleague-8556', 'www. and either parameter order are fine');
  assert.equal(www.scorecardUrl, u.scorecardUrl);
  assert.throws(() => parseMatchUrl('https://cricclubs.com/MississaugaCricketLeague/ballbyball.do?clubId=2565&matchId=8556'), RejectedMatch);
  assert.throws(() => parseMatchUrl('https://evil.com/X/fullScorecard.do?matchId=1'), RejectedMatch);
  assert.throws(() => parseMatchUrl('https://cricclubs.com/X/fullScorecard.do?clubId=1'), RejectedMatch);
  assert.equal(
    findScorecardLink('### Link\n\nhttps://cricclubs.com/MississaugaCricketLeague/fullScorecard.do?clubId=2565&amp;matchId=8556\n'),
    'https://cricclubs.com/MississaugaCricketLeague/fullScorecard.do?clubId=2565&matchId=8556',
  );
  assert.equal(findScorecardLink('no link here'), null);
});

test('overs to balls', () => {
  assert.equal(oversToBalls('3.4'), 22);
  assert.equal(oversToBalls('4'), 24);
});

test('scorecard: picks our cards, reads stats, DNB and meta', () => {
  const m = buildMatch({ scorecardHtml: fixture, players, config });
  assert.equal(m.date, '2026-06-14');
  assert.equal(m.opponent, 'Brampton Strikers');
  assert.match(m.result, /won by 23 runs/);
  const by = Object.fromEntries(m.players.map((p) => [p.playerId, p]));
  assert.deepEqual([by['omkar-bhilare'].bat.runs, by['omkar-bhilare'].bat.balls], [42, 31]);
  assert.equal(by['omkar-bhilare'].bowl.wickets, 2);
  assert.equal(by['alston-d-mello'].bat.notOut, true);
  assert.equal(by['jaideep-bajwa'].bat.notOut, false);
  assert.equal(by['dhruv-sardana'].bowl.balls, 22);
  assert.equal(by['dhruv-sardana'].batted, false, 'DNB but bowled');
  assert.ok(by['shailin-gosalia'], 'DNB-only player counted in XI');
  assert.equal(m.players.length, 11);
  assert.ok(m.players.every((p) => p.playerId));
});

test('rejects a scorecard with a player not on the roster', () => {
  const html = fixture.replace('>Aditya Peri<', '>Some Guest<');
  assert.throws(() => buildMatch({ scorecardHtml: html, players, config }), (e) => e instanceof RejectedMatch && /Some Guest/.test(e.message) && e.unknown.includes('Some Guest'));
  const withAlias = players.map((p) => (p.id === 'aditya-peri' ? { ...p, aliases: ['Some Guest'] } : p));
  const m = buildMatch({ scorecardHtml: html, players: withAlias, config });
  assert.ok(m.players.some((p) => p.playerId === 'aditya-peri'), 'an alias fixes it');
});

test('season build resolves ids and adds extra players', () => {
  const m = { id: 'x-1', date: '2026-06-14', ...buildMatch({ scorecardHtml: fixture, players, config }), extraPlayers: ['ali-naqvi'] };
  const s = buildSeason([m], players);
  assert.equal(s.matches[0].players.length, 12);
  assert.deepEqual(s.unmatchedNames, []);
  assert.equal(buildSeason(s.matches, players).matches[0].players.length, 12, 'rebuilding is idempotent');
});

test('rejects a scorecard with a near-miss name', () => {
  const html = fixture.replace('>Jaideep Bajwa<', '>J Bajwa<');
  assert.throws(() => buildMatch({ scorecardHtml: html, players, config }), (e) => e instanceof RejectedMatch && /J Bajwa/.test(e.message));
});

test('rejects a match that is not ours', () => {
  const html = fixture.replaceAll('True Blue Falcons', 'Red Hawks');
  assert.throws(() => buildMatch({ scorecardHtml: html, players, config }), (e) => e instanceof RejectedMatch && /not a True Blue Falcons match/.test(e.message));
  const partial = fixture.replaceAll('True Blue Falcons', 'True Blue Falcons B');
  assert.throws(() => buildMatch({ scorecardHtml: partial, players, config }), RejectedMatch, 'team name must be exact');
});
