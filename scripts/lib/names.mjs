// Name normalisation and roster matching.
// CricClubs shows names in many shapes: "Omkar Bhilare", "O Bhilare", "Bhilare O",
// "Omkar Bhilare (c)", "Omkar Bhilare*", "Omkar Bhilare †". This maps any of those
// back to a roster player id, or null if it can't be matched unambiguously.

export function cleanName(raw = '') {
  return String(raw)
    .replace(/ /g, ' ')
    .replace(/\([^)]*\)/g, ' ') // (c) (wk) (vc)
    .replace(/[*†‡]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function norm(raw = '') {
  return cleanName(raw)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '') // D'mello -> dmello
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildMatcher(players) {
  const entries = players.map((p) => {
    const first = norm(p.first);
    const last = norm(p.last);
    const full = `${first} ${last}`.trim();
    const keys = new Set([full, ...(p.aliases || []).map(norm)].filter(Boolean));
    return {
      id: p.id,
      keys,
      firstTok: first.split(' ')[0],
      firstToks: first.split(' '),
      lastTok: last.split(' ').slice(-1)[0],
      allToks: full.split(' '),
    };
  });

  const unique = (list) => (list.length === 1 ? list[0].id : null);

  return function match(rawName) {
    const n = norm(rawName);
    if (!n) return null;

    // 1. exact full name or alias
    const exact = entries.filter((e) => e.keys.has(n));
    if (exact.length) return unique(exact);

    const toks = n.split(' ');
    const f = toks[0];
    const l = toks[toks.length - 1];

    if (toks.length >= 2) {
      // 2. first + last token ("Hritik Advani" for "Hritik Kumar Advani")
      let c = entries.filter((e) => e.firstTok === f && e.lastTok === l);
      if (c.length) return unique(c);
      // 3. reversed ("Bhilare Omkar")
      c = entries.filter((e) => e.firstTok === l && e.lastTok === f);
      if (c.length) return unique(c);
      // 4. initials ("O Bhilare", "Bhilare O", "OS Rana")
      if (f.length <= 2) {
        c = entries.filter((e) => e.lastTok === l && e.firstTok.startsWith(f[0]));
        if (c.length) return unique(c);
      }
      if (l.length <= 2) {
        c = entries.filter((e) => e.lastTok === f && e.firstTok.startsWith(l[0]));
        if (c.length) return unique(c);
      }
      // 5. every token of the raw name appears in the roster name
      c = entries.filter((e) => toks.every((t) => e.allToks.includes(t)));
      if (c.length) return unique(c);
      // 6. last name unique on the roster AND first name agrees by initial
      c = entries.filter((e) => e.lastTok === l && e.firstTok[0] === f[0]);
      if (c.length) return unique(c);
      return null;
    }

    // single token: unique first name, else unique last name
    let c = entries.filter((e) => e.firstTok === f);
    if (c.length === 1) return c[0].id;
    c = entries.filter((e) => e.lastTok === f);
    return unique(c);
  };
}
