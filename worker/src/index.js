// Admin API for the True Blue Falcons stats site (Cloudflare Worker).
//
// The website is static (GitHub Pages), so it cannot keep a password or a GitHub
// token. This Worker holds both as secrets:
//   POST /auth    -> 204 if the password is right
//   POST /ingest  -> checks the match hasn't been parsed, then starts the
//                    "Update site" GitHub Actions workflow with the URL
//   GET  /status  -> the last few workflow runs, for the admin page
//
// Secrets (wrangler secret put ...): ADMIN_PASSWORD, GITHUB_TOKEN
// Vars (wrangler.toml): GITHUB_REPO, GITHUB_BRANCH, ALLOWED_ORIGINS, WORKFLOW_FILE

const enc = new TextEncoder();

async function sameSecret(a, b) {
  // constant-time comparison via HMAC of both values
  const key = await crypto.subtle.importKey('raw', enc.encode('tbf-compare'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [x, y] = await Promise.all([crypto.subtle.sign('HMAC', key, enc.encode(a)), crypto.subtle.sign('HMAC', key, enc.encode(b))]);
  const ax = new Uint8Array(x), ay = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ ay[i];
  return diff === 0;
}

function cors(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    'access-control-allow-origin': ok ? origin : allowed[0] || 'null',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'tbf-cricket-admin',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
}

function parseMatch(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)cricclubs\.com$/i.test(u.hostname) || u.protocol !== 'https:') return null;
  const league = u.pathname.split('/').filter(Boolean)[0];
  const id = [...u.searchParams].find(([k]) => k.toLowerCase() === 'matchid');
  if (!league || !/^[A-Za-z0-9_-]+$/.test(league) || !id || !/^\d+$/.test(id[1])) return null;
  return { league, matchId: id[1], key: `${league.toLowerCase()}-${id[1]}` };
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const { pathname } = new URL(req.url);

    const pw = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.ADMIN_PASSWORD || !(await sameSecret(pw, env.ADMIN_PASSWORD))) {
      await new Promise((r) => setTimeout(r, 600)); // slow down guessing
      return json({ error: 'Wrong password' }, 401, h);
    }

    if (pathname === '/auth' && req.method === 'POST') return new Response(null, { status: 204, headers: h });

    if (pathname === '/ingest' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400, h); }
      const m = parseMatch(String(body.url || '').trim());
      if (!m) return json({ error: 'Paste a cricclubs.com match link that contains matchId=<number>.' }, 400, h);
      const tournament = /^[a-z0-9-]{1,32}$/.test(body.tournament || '') ? body.tournament : 'auto';

      // once per match: refuse if the match file already exists on the branch
      const exists = await gh(env, `/contents/data/matches/${m.key}.json?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`);
      if (exists.status === 200) return json({ error: `Match ${m.matchId} has already been parsed. Each match can only be parsed once.` }, 409, h);

      const r = await gh(env, `/actions/workflows/${env.WORKFLOW_FILE}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref: env.GITHUB_BRANCH, inputs: { url: String(body.url).trim(), tournament } }),
      });
      if (r.status !== 204) return json({ error: `GitHub refused to start the workflow (${r.status}): ${(await r.text()).slice(0, 200)}` }, 502, h);
      return json({ ok: true, match: m.key, message: `Parsing match ${m.matchId} (${m.league}).` }, 202, h);
    }

    if (pathname === '/status' && req.method === 'GET') {
      const r = await gh(env, `/actions/workflows/${env.WORKFLOW_FILE}/runs?per_page=6&event=workflow_dispatch`);
      if (!r.ok) return json({ error: `GitHub API ${r.status}` }, 502, h);
      const data = await r.json();
      const runs = (data.workflow_runs || []).map((x) => ({
        number: x.run_number,
        title: x.display_title,
        status: x.status,
        conclusion: x.conclusion,
        created_at: x.created_at,
        url: x.html_url,
      }));
      return json({ runs }, 200, h);
    }

    return json({ error: 'Not found' }, 404, h);
  },
};
