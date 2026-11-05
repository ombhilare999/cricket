# True Blue Falcons: season stats

A static stats site for the True Blue Falcons cricket club, served at **omkarbhilare.com/cricket**. For each player it shows matches played against their quota (full = 16, half = 8, out of 24), balls faced, batting opportunities, balls bowled and bowling opportunities, so the workload can be shared fairly. It covers both tournaments, Lakeshore and the Mississauga Cricket League.

## How it fits together

```
Admin page (admin.html) ──password──▶ Cloudflare Worker (worker/)
                                        │ checks password, refuses already-parsed matches
                                        ▼
                         GitHub Actions "Update site" (.github/workflows/site.yml)
                           1. downloads the CricClubs scorecard + ball-by-ball pages
                           2. parses our players' stats → data/matches/<league>-<matchId>.json
                           3. commits, rebuilds data/season.json, deploys to GitHub Pages
                                        ▼
                         omkarbhilare.com/cricket  (index.html renders data/season.json)
```

* **No database.** Every match is a JSON file in `data/matches/`, so the history is in git.
* **Each match is parsed only once.** The Worker and the ingest script both refuse a match whose file already exists.
* **Your portfolio is not touched.** Your user site (`ombhilare999.github.io`) already uses the custom domain `omkarbhilare.com`. GitHub Pages serves any *project* repo of yours at `omkarbhilare.com/<repo-name>/`, so a repo named `cricket` appears at `/cricket` automatically.

## One-time setup

1. **Rename this repo to `cricket`.** Go to Settings → General → Repository name. GitHub redirects the old URL.
2. **Make `main` the default branch** and merge this work into it.
3. **Turn on Pages.** Go to Settings → Pages → Build and deployment → Source: **GitHub Actions**. The next push to `main` deploys the site to `https://omkarbhilare.com/cricket/`.
4. **Create a GitHub token for the Worker.** Use GitHub → Settings → Developer settings → Fine-grained tokens:
   * Repository access: only `ombhilare999/cricket`
   * Permissions: **Actions: Read and write**, **Contents: Read-only**
5. **Deploy the admin Worker** (needs a free Cloudflare account):
   ```bash
   cd worker
   npx wrangler login
   npx wrangler secret put ADMIN_PASSWORD   # the password you'll type on the admin page
   npx wrangler secret put GITHUB_TOKEN     # the token from step 4
   npx wrangler deploy                      # prints https://tbf-cricket-admin.<you>.workers.dev
   ```
6. Put that Worker URL in `data/config.json` → `adminApi`, then commit to `main`.

## Adding a match

Open `omkarbhilare.com/cricket/admin.html`, sign in, paste the CricClubs link and press **Parse match**. Either the ball-by-ball link or the scorecard link works, for example:
`https://cricclubs.com/MississaugaCricketLeague/ballbyball.do?clubId=2565&matchId=8556`

The tournament is detected from the link (`Mississauga…` → MCL, `Lakeshore…` → Lakeshore), or you can pick it yourself. The stats update about a minute later. Each run's summary on GitHub lists every player it found and how it matched them to the roster.

**Fallback without the Worker:** go to GitHub → Actions → *Update site* → *Run workflow* and paste the link there.

## Fixing data

| Problem | Fix |
|---|---|
| A CricClubs name didn't match a member (listed under *Names to check* on the admin page) | Add it to that player's `aliases` in `data/players.json`, then push. Old matches pick it up automatically. |
| A player fielded but neither batted nor bowled, and is missing from the card | Add `"extraPlayers": ["player-id"]` to that match's file in `data/matches/` |
| Wrong date | Add `"dateOverride": "2026-06-14"` to the match file |
| Roster or tier change | Edit `data/players.json` (`tier`: `full`, `half` or `none`) |
| Parser improved and you want to re-read old matches | `node scripts/ingest.mjs --url <link> --reparse` re-reads the raw pages saved in `data/raw/` |

## Display rules

* **Full** members have top priority and a cap of 16 matches. **Half** members come second, with a cap of 8. **Per-match** (`none`) players are hidden unless the *Per-match players* switch is on.
* Each quota bar has a tick for where the player should be by now: `cap × team matches played ÷ 24`. A player more than one game behind it is marked **Due a game**.
* The season-places panel compares the places left (remaining matches × 11) with the games members are still owed. Member caps add up to 15×16 + 5×8 = **280**, but only 24×11 = **264** places exist, so the season starts 16 places short.
* **Batting opportunity** means the player batted in that match. **Bowling opportunity** means they bowled at least one legal ball.

## Development

```bash
npm install
npm test                          # parser tests against sample pages in test/fixtures/
npm run serve                     # http://localhost:8080/cricket/
node scripts/ingest.mjs --url <link> --scorecard-html saved-page.html   # parse a page saved from a browser
```

Settings such as caps, total matches, tournaments, team aliases and the logo path live in `data/config.json`. To use the club's real logo, add the image to `assets/` and point `logo` at it.
