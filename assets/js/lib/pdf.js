// Reads the CricClubs scorecard PDF ("Score Card PDF" page, printed or saved as PDF).
//
// pdf.js gives text as small fragments with x/y positions, not as tables. We rebuild the
// lines, find the batting ("S.No Batsman How Out Runs Balls …") and bowling ("S.No Bowler
// Overs Mdns Runs Wkts …") headers, put every fragment of the rows below into the column
// whose header starts at or left of it, and hand those rows to the same interpreter the
// HTML scorecard uses (parse.js interpretTables). Works in the browser and in Node.

import { interpretTables, parseMeta } from './parse.js';
import { findScorecardLink } from './match.js';

const txt = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Text lines of a PDF, top to bottom, page by page.
 * @param pdfjs the pdf.js module (pdfjs-dist), already set up with a worker in the browser
 * @param {Uint8Array} data the PDF file
 * @returns {Promise<{page:number, y:number, items:{x:number, end:number, str:string}[]}[]>}
 */
export async function readPdfLines(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const frags = items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ x: it.transform[4], y: it.transform[5], end: it.transform[4] + (it.width || 0), str: it.str }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const pageLines = [];
    for (const f of frags) {
      const line = pageLines.find((l) => Math.abs(l.y - f.y) <= 2);
      if (line) line.items.push(f);
      else pageLines.push({ page: p, y: f.y, items: [f] });
    }
    for (const l of pageLines) l.items.sort((a, b) => a.x - b.x);
    lines.push(...pageLines.sort((a, b) => b.y - a.y));
  }
  await doc.destroy();
  return lines;
}

// fragments closer than this are one word; further apart, a space; much further, a new cell
const WORD_GAP = 1.5;
const CELL_GAP = 24;

function words(items) {
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && it.x - last.end <= WORD_GAP) {
      last.text += it.str;
      last.end = Math.max(last.end, it.end);
    } else {
      out.push({ text: it.str.trim(), x: it.x, end: it.end });
    }
  }
  return out.filter((w) => w.text);
}

/** A line split into visual cells (big gaps), e.g. "Match:" | "Toss:". */
function segments(items) {
  const out = [];
  for (const w of words(items)) {
    const last = out[out.length - 1];
    if (last && w.x - last.end <= CELL_GAP) {
      last.text += ' ' + w.text;
      last.end = w.end;
    } else {
      out.push({ ...w });
    }
  }
  return out.map((s) => txt(s.text));
}

const MULTI = ['how out', 'no balls', 'player name'];
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Column headers of a batting/bowling header line: [{ label, x }] */
function headerColumns(line) {
  const ws = words(line.items);
  const cols = [];
  for (let i = 0; i < ws.length; i++) {
    const two = i + 1 < ws.length ? (ws[i].text + ' ' + ws[i + 1].text).toLowerCase() : '';
    if (MULTI.includes(two)) {
      cols.push({ label: ws[i].text + ' ' + ws[i + 1].text, x: ws[i].x });
      i++;
    } else {
      cols.push({ label: ws[i].text, x: ws[i].x });
    }
  }
  return cols;
}

function headerKind(line) {
  const labels = words(line.items).map((w) => norm(w.text));
  if (labels.includes('batsman') && labels.includes('runs') && labels.includes('balls')) return 'batting';
  if (labels.includes('bowler') && labels.includes('overs') && labels.includes('wkts')) return 'bowling';
  return null;
}

const cell = (text) => ({ text: txt(text), linkText: '', lines: text ? [txt(text)] : [], pid: null, colspan: 1 });

function rowCells(line, cols) {
  const buckets = cols.map(() => []);
  for (const it of line.items) {
    let k = 0;
    for (let i = 0; i < cols.length; i++) if (cols[i].x <= it.x + 4) k = i;
    buckets[k].push(it);
  }
  return buckets.map((b) => cell(words(b).map((w) => w.text).join(' ')));
}

const INNINGS = /^(.+?)\s+-\s+\d+$/; // "True Blue Falcons - 1"

/**
 * Parse the lines of a scorecard PDF into the same shape parse.js parseScorecard returns,
 * plus the CricClubs link printed in the page footer, if the browser printed one.
 */
export function parsePdfScorecard(lines, { ballsPerOver = 6 } = {}) {
  const tables = [];
  const innings = [];
  const body = [];
  let current = null;
  for (const line of lines) {
    const segs = segments(line.items);
    const whole = segs.join(' ');
    body.push(...segs);
    const kind = headerKind(line);
    if (kind) {
      const cols = headerColumns(line);
      current = { cols, rows: [cols.map((c) => cell(c.label))] };
      tables.push(current.rows);
      continue;
    }
    const inn = whole.match(INNINGS);
    if ((inn && segs.length === 1) || /^fall of wickets/i.test(whole)) {
      if (inn) innings.push(txt(inn[1]));
      current = null;
      continue;
    }
    if (!current) continue;
    const cells = rowCells(line, current.cols);
    // player rows start with their number; Extras/Total rows are kept so the interpreter skips them
    if (/^\d+$/.test(cells[0].text) || /^(extras|total)/i.test(cells[0].text)) current.rows.push(cells);
  }
  const bodyText = body.join('\n');
  const { battingCards, bowlingCards } = interpretTables(tables, ballsPerOver);
  return {
    battingCards,
    bowlingCards,
    looseDnb: [],
    labels: [...new Set([...innings, ...body.filter((s) => s.length <= 80)])],
    meta: parseMeta({ title: '', headings: innings }, bodyText),
    link: findScorecardLink(bodyText),
  };
}
