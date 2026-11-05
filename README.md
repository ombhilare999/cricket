# True Blue Falcons: season stats

A static stats site for the True Blue Falcons cricket club, served at **omkarbhilare.com/cricket**. For each player it shows matches played against their quota (full = 16, half = 8, out of 24), balls faced, batting opportunities, balls bowled and bowling opportunities, so the workload can be shared fairly. It covers both tournaments, Lakeshore and the Mississauga Cricket League.

## How it fits together

```
Admin page (admin.html), signed in with the admin key
        │ checks the match hasn't been parsed, then starts the workflow (GitHub API)
        ▼
GitHub Actions "Update site" (.github/workflows/site.yml)
  1. downloads the CricClubs scorecard + ball-by-ball pages
  2. parses our players' stats → data/matches/<league>-<matchId>.json
  3. commits, rebuilds data/season.json, deploys to GitHub Pages
        ▼
omkarbhilare.com/cricket  (index.html renders data/season.json)
```

* **No server and no database.** Every match is a JSON file in `data/matches/`, so the history is in git.
* **Admin key.** The site is static, so it can't keep a password. The admin signs in with a fine-grained GitHub token instead, and that token can do one thing: start this repo's workflow. It lives only in the admin's browser. Without it the admin page does nothing.
* **Each match is parsed only once.** The admin page checks before starting the workflow, and the ingest script refuses a match whose data file already exists.
* **Your portfolio is not touched.** Your user site (`ombhilare999.github.io`) already uses the custom domain `omkarbhilare.com`. GitHub Pages serves this `cricket` repo at `omkarbhilare.com/cricket/`.

## Admin key (one time)

1. Create a token with [this pre-filled link](https://github.com/settings/personal-access-tokens/new?name=TBF%20cricket%20admin&target_name=ombhilare999&expires_in=366&actions=write&contents=read). If the form doesn't pick up the settings, choose them by hand:
   * Repository access: **Only select repositories** → `ombhilare999/cricket`
   * Repository permissions: **Actions: Read and write**, **Contents: Read-only**
2. Open `omkarbhilare.com/cricket/admin.html`, paste the token as the admin key and tick *Remember on this device*.

Tokens expire, after a year at most. When yours does, the admin page will say the key wasn't accepted, and you create a new one the same way.

## Adding a match

On the admin page, paste the CricClubs link and press **Parse match**. Either the ball-by-ball link or the scorecard link works, for example:
`https://cricclubs.com/MississaugaCricketLeague/ballbyball.do?clubId=2565&matchId=8556`

The tournament is detected from the link (`Mississauga…` → MCL, `Lakeshore…` → Lakeshore), or you can pick it yourself. The stats update about a minute later. Each run's summary on GitHub lists every player it found and how it matched them to the roster.

**Fallback:** go to GitHub → Actions → *Update site* → *Run workflow* and paste the link there.

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
