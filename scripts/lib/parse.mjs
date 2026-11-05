// Parsers for CricClubs match pages.
//
// The scorecard parser does not depend on CricClubs CSS class names. It reads every
// innermost <table>, decides from the header row whether it is a batting card
// (has R + B) or a bowling card (has O + R + W), and reads columns by header name.
// Which card belongs to our team is decided later by matching names to the roster,
// so we never need to know which team name the page puts above each innings.
//
// The ball-by-ball parser is a fallback for when the scorecard can't be read. It turns
// the page into text lines and reads commentary of the form
// "12.3  Bowler to Batter, 2 runs".

import * as cheerio from 'cheerio';
import { cleanName } from './names.mjs';

const SKIP_ROW = /^(extras?|total|fall of wickets?|did not bat|yet to bat|dnb|bowling|batting|batter|batsman|bowler|byes?)\b/i;

const txt = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const num = (s) => {
  const m = txt(s).match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

export function oversToBalls(o, bpo = 6) {
  if (o == null || o === '') return 0;
  const [ov, b = '0'] = String(o).trim().split('.');
  return (parseInt(ov, 10) || 0) * bpo + (parseInt(b, 10) || 0);
}

function headerIndex(headers, names) {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

function readTables($) {
  const tables = [];
  $('table').each((_, t) => {
    if ($(t).find('table').length) return; // layout table, skip; inner tables are read separately
    const rows = [];
    $(t)
      .find('tr')
      .each((__, tr) => {
        const cells = $(tr)
          .children('th,td')
          .map((___, c) => {
            const $c = $(c);
            const link = $c.find('a').first();
            const linkText = link.length ? txt(link.text()) : '';
            const href = link.attr('href') || '';
            const pid = (href.match(/playerId=(\d+)/i) || [])[1] || null;
            // keep line structure inside a cell: name often sits above the dismissal text
            const html = ($c.html() || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|span|small|li)>/gi, '\n');
            const lines = cheerio
              .load(`<x>${html}</x>`)('x')
              .text()
              .split('\n')
              .map(txt)
              .filter(Boolean);
            return { text: txt($c.text()), linkText, lines, pid, colspan: Number($c.attr('colspan') || 1) };
          })
          .get();
        if (cells.length) rows.push(cells);
      });
    if (rows.length) tables.push(rows);
  });
  return tables;
}

function expandColspan(row) {
  const out = [];
  for (const c of row) {
    out.push(c);
    for (let k = 1; k < c.colspan; k++) out.push({ text: '', linkText: '', lines: [], pid: null, colspan: 1 });
  }
  return out;
}

function classify(rows) {
  for (let h = 0; h < Math.min(rows.length, 3); h++) {
    const headers = expandColspan(rows[h]).map((c) => c.text.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const iR = headerIndex(headers, ['r', 'runs']);
    const iB = headerIndex(headers, ['b', 'balls']);
    const iO = headerIndex(headers, ['o', 'ov', 'overs']);
    const iW = headerIndex(headers, ['w', 'wkts', 'wickets', 'wkt']);
    if (iO >= 0 && iW >= 0 && iR >= 0) {
      return {
        kind: 'bowling',
        headerRow: h,
        idx: {
          name: Math.max(0, headerIndex(headers, ['bowler', 'bowling', 'name', 'player'])),
          o: iO,
          m: headerIndex(headers, ['m', 'mdns', 'maidens', 'md']),
          r: iR,
          w: iW,
          wd: headerIndex(headers, ['wd', 'wides', 'wide']),
          nb: headerIndex(headers, ['nb', 'noballs', 'noball']),
          dots: headerIndex(headers, ['dots', 'dot', '0s']),
        },
      };
    }
    if (iR >= 0 && iB >= 0) {
      return {
        kind: 'batting',
        headerRow: h,
        idx: {
          name: Math.max(0, headerIndex(headers, ['batter', 'batsman', 'batting', 'batsmen', 'name', 'player'])),
          r: iR,
          b: iB,
          fours: headerIndex(headers, ['4s', 'fours', '4']),
          sixes: headerIndex(headers, ['6s', 'sixes', '6']),
        },
      };
    }
  }
  return null;
}

function nameAndDismissal(cells, nameIdx, firstStatIdx) {
  const c = cells[nameIdx];
  let name = c.linkText || c.lines[0] || c.text;
  let dismissal = '';
  if (c.lines.length > 1) dismissal = c.lines.filter((l) => txt(l) !== txt(name)).join(' ');
  else if (c.linkText && c.text.length > c.linkText.length) dismissal = txt(c.text.replace(c.linkText, ''));
  // textual cells between the name and the first stat column (CricClubs puts the dismissal there)
  for (let i = nameIdx + 1; i < firstStatIdx && i < cells.length; i++) {
    if (cells[i].text && num(cells[i].text) == null) dismissal = txt(`${dismissal} ${cells[i].text}`);
  }
  return { name: cleanName(name), dismissal, pid: c.pid };
}

function parseBatting(rows, cls) {
  const { idx } = cls;
  const out = [];
  const dnb = [];
  let pos = 0;
  for (const raw of rows.slice(cls.headerRow + 1)) {
    const cells = expandColspan(raw);
    const first = cells[idx.name]?.text || cells[0]?.text || '';
    const dnbMatch = cells.map((c) => c.text).join(' ').match(/(did not bat|yet to bat|dnb)\s*:?\s*(.+)$/i);
    if (dnbMatch) {
      dnb.push(...splitNames(dnbMatch[2]));
      continue;
    }
    if (!first || SKIP_ROW.test(first)) continue;
    if (cells.length <= Math.max(idx.r, idx.b)) continue;
    const { name, dismissal, pid } = nameAndDismissal(cells, idx.name, Math.min(idx.r, idx.b));
    if (!name || /^\d/.test(name)) continue;
    const runs = num(cells[idx.r]?.text);
    const balls = num(cells[idx.b]?.text);
    const didNotBat = /did not bat|\bdnb\b/i.test(dismissal) || (runs == null && balls == null);
    if (didNotBat) {
      dnb.push(name);
      continue;
    }
    pos += 1;
    out.push({
      name,
      cricclubsId: pid,
      pos,
      runs: runs ?? 0,
      balls: balls ?? 0,
      fours: idx.fours >= 0 ? num(cells[idx.fours]?.text) ?? 0 : 0,
      sixes: idx.sixes >= 0 ? num(cells[idx.sixes]?.text) ?? 0 : 0,
      dismissal,
      notOut: !dismissal || /not\s*out|retired\s*(hurt|not out)|batting/i.test(dismissal),
    });
  }
  return { batters: out, dnb };
}

function parseBowling(rows, cls, bpo) {
  const { idx } = cls;
  const out = [];
  for (const raw of rows.slice(cls.headerRow + 1)) {
    const cells = expandColspan(raw);
    const first = cells[idx.name]?.text || '';
    if (!first || SKIP_ROW.test(first)) continue;
    if (cells.length <= Math.max(idx.o, idx.r, idx.w)) continue;
    const overs = txt(cells[idx.o]?.text);
    if (!/^\d+(\.\d)?$/.test(overs)) continue;
    const c = cells[idx.name];
    const pick = (i) => (i >= 0 ? num(cells[i]?.text) ?? 0 : 0);
    out.push({
      name: cleanName(c.linkText || c.lines[0] || c.text),
      cricclubsId: c.pid,
      overs,
      balls: oversToBalls(overs, bpo),
      maidens: pick(idx.m),
      runs: pick(idx.r),
      wickets: pick(idx.w),
      wides: pick(idx.wd),
      noballs: pick(idx.nb),
      dots: pick(idx.dots),
    });
  }
  return out;
}

function splitNames(s) {
  return String(s)
    .split(/,|;|\band\b|\n/)
    .map(cleanName)
    .filter((n) => n && n.length > 1 && !/^\d/.test(n));
}

/** Parse a CricClubs full scorecard page into innings cards. */
export function parseScorecard(html, { ballsPerOver = 6 } = {}) {
  const $ = cheerio.load(html);
  $('script,style,noscript').remove();
  const battingCards = [];
  const bowlingCards = [];
  for (const rows of readTables($)) {
    const cls = classify(rows);
    if (!cls) continue;
    if (cls.kind === 'batting') {
      const card = parseBatting(rows, cls);
      if (card.batters.length || card.dnb.length) battingCards.push(card);
    } else {
      const bowlers = parseBowling(rows, cls, ballsPerOver);
      if (bowlers.length) bowlingCards.push(bowlers);
    }
  }
  // "Did not bat: A, B, C" often sits outside the table, as a plain paragraph
  const looseDnb = [];
  const bodyText = pageText($);
  for (const m of bodyText.matchAll(/(?:did not bat|yet to bat)\s*:?\s*([^\n]+)/gi)) looseDnb.push(...splitNames(m[1]));
  return { battingCards, bowlingCards, looseDnb, meta: parseMeta($, bodyText) };
}

function pageText($) {
  const html = ($('body').html() || $.html())
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h\d|table|section|ul|ol)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<\/(span|a|b|strong|em|i|small|label)>/gi, ' $&');
  return cheerio
    .load(html)
    .root()
    .text()
    .split('\n')
    .map(txt)
    .filter(Boolean)
    .join('\n');
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';

export function parseMeta($, bodyText) {
  const title = txt($('title').text());
  const headings = $('h1,h2,h3,h4')
    .map((_, h) => txt($(h).text()))
    .get()
    .filter(Boolean);
  const vsSource = [title, ...headings, ...bodyText.split('\n').slice(0, 80)].find((s) => /\s(vs?\.?|versus)\s/i.test(s)) || '';
  let teams = [];
  const vs = vsSource.match(/(.+?)\s+(?:vs?\.?|versus)\s+(.+)/i);
  if (vs) {
    // "Ball by Ball - A vs B | League" -> ["A", "B"]
    teams = [txt(vs[1].replace(/^.*\s[:|–-]\s*/, '').replace(/^.*[:|]\s*/, '')), txt(vs[2].replace(/\s+[|–-]\s.*$/, '').replace(/\s*\|.*$/, ''))];
  }
  const result = (bodyText.match(/([A-Z][^\n]{1,60}?\b(?:won by|won the match|beat)\b[^\n]{0,60})/) ||
    bodyText.match(/\b(match (?:tied|drawn|abandoned)|no result|tied)\b[^\n]{0,40}/i) || [])[0];

  let date = null;
  const iso = bodyText.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  const us = bodyText.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/);
  const long = bodyText.match(new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(20\\d\\d)\\b`, 'i'));
  const longRev = bodyText.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})[a-z]*\\.?,?\\s+(20\\d\\d)\\b`, 'i'));
  const mi = (m) => MONTHS.split('|').indexOf(m.toLowerCase().slice(0, 3)) + 1;
  const pad = (n) => String(n).padStart(2, '0');
  if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (us) date = `${us[3]}-${pad(us[1])}-${pad(us[2])}`; // CricClubs (North America) uses MM/DD/YYYY
  else if (long) date = `${long[3]}-${pad(mi(long[1]))}-${pad(long[2])}`;
  else if (longRev) date = `${longRev[3]}-${pad(mi(longRev[2]))}-${pad(longRev[1])}`;

  return { title, teams, result: result ? txt(result) : null, date };
}

// ---------------------------------------------------------------- ball by ball

// "12.3 Bowler to Batter, 2 runs", optionally with a run badge after the over number
// ("12.3 4 Bowler to Batter, FOUR" / "0.2 wd Bowler to Batter, wide").
const BALL_LINE = /^(\d{1,2})\.(\d{1,2})\s*[-:]?\s*(?:(?:[0-7]|w|wd\d?|nb\d?|lb\d?|b\d)\s+(?=\S+\s+\S))?(.+?)\s+to\s+(.+?)\s*(?:[,:\-–]|\s{2,})\s*(.*)$/i;

/** Classify the commentary after "X to Y,". */
export function classifyBall(rest) {
  const r = ` ${rest.toLowerCase()} `;
  const n = (re) => {
    const m = r.match(re);
    return m ? Number(m[1]) : null;
  };
  const wide = /\bwides?\b|\bwd\b/.test(r);
  const noball = /no[\s-]?ball|\bnb\b/.test(r);
  const legbye = /leg[\s-]?byes?|\blb\b/.test(r);
  const bye = !legbye && /\bbyes?\b/.test(r);
  let runs = 0;
  if (/\bsix\b|\b6 runs\b/.test(r)) runs = 6;
  else if (/\bfour\b|\b4 runs\b/.test(r)) runs = 4;
  else runs = n(/\b(\d+)\s*runs?\b/) ?? n(/^\s*(\d)\b/) ?? 0;
  if (/\bno run\b|\bdot\b/.test(r) && !/\b\d+\s*runs?\b/.test(r)) runs = 0;
  const wicket = /\bout\b|\bwicket\b|\bbowled\b|\bcaught\b|\blbw\b|\bstumped\b|\bhit wicket\b/.test(r) && !/\bnot out\b/.test(r);
  const runOut = /\brun\s*out\b/.test(r);
  return { wide, noball, legbye, bye, runs, wicket, runOut };
}

/** Parse ball-by-ball commentary into per-innings per-player tallies. */
export function parseBallByBall(html, { ballsPerOver = 6 } = {}) {
  const $ = cheerio.load(html);
  $('script,style,noscript').remove();
  const lines = pageText($).split('\n');
  // join "12.3" on its own line with the commentary on the next line
  const joined = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\d{1,2}\.\d{1,2}$/.test(lines[i]) && lines[i + 1]) {
      // sometimes a run badge ("1", "W", "4") sits between the over number and the text
      if (/^([0-9]|w|wd|nb|lb|b)\w?$/i.test(lines[i + 1]) && lines[i + 2]) {
        joined.push(`${lines[i]} ${lines[i + 2]}`);
        i += 2;
      } else {
        joined.push(`${lines[i]} ${lines[i + 1]}`);
        i += 1;
      }
    } else joined.push(lines[i]);
  }

  // 1. group commentary lines into innings
  const groups = [];
  let cur = null;
  let lastOver = null;
  for (const line of joined) {
    const m = line.match(BALL_LINE);
    if (!m) continue;
    const over = Number(m[1]);
    // A new innings starts where the over number jumps between the first over and a
    // much later one. Works whether commentary is listed oldest-first or newest-first,
    // and whether overs are numbered from 0 or 1.
    const jump = lastOver != null && ((over <= 1 && lastOver >= 4) || (lastOver <= 1 && over >= 4));
    if (!cur || jump) {
      cur = [];
      groups.push(cur);
    }
    lastOver = over;
    cur.push({ over, ball: Number(m[2]), bowler: cleanName(m[3]), batter: cleanName(m[4]), rest: m[5] || '' });
  }

  // 2. tally each innings in chronological order
  const innings = groups.map((events) => {
    if (events.length > 1 && events[0].over * 100 + events[0].ball > events.at(-1).over * 100 + events.at(-1).ball) events.reverse();
    const inn = { batters: new Map(), bowlers: new Map() };
    for (const ev of events) {
      const o = classifyBall(ev.rest);
      const bat = inn.batters.get(ev.batter) || { name: ev.batter, runs: 0, balls: 0, fours: 0, sixes: 0, out: false };
      const bowl = inn.bowlers.get(ev.bowler) || { name: ev.bowler, balls: 0, runs: 0, wickets: 0, wides: 0, noballs: 0, dots: 0 };
      if (o.wide) {
        bowl.wides += 1;
        bowl.runs += Math.max(1, o.runs);
      } else {
        bat.balls += 1;
        if (!o.bye && !o.legbye) {
          bat.runs += o.runs;
          if (o.runs === 4) bat.fours += 1;
          if (o.runs === 6) bat.sixes += 1;
          bowl.runs += o.runs + (o.noball ? 1 : 0);
        } else if (o.noball) bowl.runs += 1;
        if (o.noball) bowl.noballs += 1;
        else {
          bowl.balls += 1;
          if (!o.runs && !o.bye && !o.legbye) bowl.dots += 1;
        }
      }
      if (o.wicket && !o.runOut) bowl.wickets += 1;
      if (o.wicket && !o.runOut) bat.out = true;
      inn.batters.set(ev.batter, bat);
      inn.bowlers.set(ev.bowler, bowl);
    }
    return inn;
  });

  const bpo = ballsPerOver;
  return {
    innings: innings.map((inn) => ({
      batters: [...inn.batters.values()].map((b, i) => ({
        name: b.name,
        pos: i + 1,
        runs: b.runs,
        balls: b.balls,
        fours: b.fours,
        sixes: b.sixes,
        notOut: !b.out,
        dismissal: b.out ? 'out' : 'not out',
      })),
      bowlers: [...inn.bowlers.values()].map((b) => ({
        name: b.name,
        overs: `${Math.floor(b.balls / bpo)}.${b.balls % bpo}`,
        balls: b.balls,
        maidens: 0,
        runs: b.runs,
        wickets: b.wickets,
        wides: b.wides,
        noballs: b.noballs,
        dots: b.dots,
      })),
    })),
    meta: parseMeta($, lines.join('\n')),
  };
}
