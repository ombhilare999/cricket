// Name normalisation and roster matching.
//
// Matching is exact: a CricClubs name counts only if it is the roster name
// (first + last) or one of the player's listed aliases. Case, extra spaces,
// punctuation and captain/keeper markers like "(c)", "(wk)", "*" and "†" are ignored,
// but nothing is guessed. "O Bhilare" does not match "Omkar Bhilare" unless it is
// added as an alias in data/players.json.

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
    .replace(/['’`]/g, '') // D'mello == Dmello == D’Mello
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildMatcher(players) {
  const byKey = new Map();
  for (const p of players) {
    for (const k of [`${p.first} ${p.last}`, ...(p.aliases || [])].map(norm).filter(Boolean)) {
      // a key shared by two players is ambiguous and matches neither
      byKey.set(k, byKey.has(k) && byKey.get(k) !== p.id ? null : p.id);
    }
  }
  return (rawName) => byKey.get(norm(rawName)) || null;
}
