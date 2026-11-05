# True Blue Falcons: season stats

A static stats site for the True Blue Falcons cricket club, served at **omkarbhilare.com/cricket**. For each player it shows matches played against their quota (full = 16, half = 8, out of 24), balls faced, batting opportunities, balls bowled and bowling opportunities, so the workload can be shared fairly. It covers both tournaments, Lakeshore and the Mississauga Cricket League.

## How it fits together

```
"Add a match" page (add.html): anyone pastes a CricClubs full scorecard link
        │ opens a pre-filled GitHub issue ("Add match: MCL 8556")
        ▼
GitHub Actions "Update site" (.github/workflows/site.yml), triggered by the issue
  1. downloads the full scorecard
  2. checks the rules (below); if any fails → explains why on the issue and closes it
  3. saves our players' stats → data/matches/<league>-<matchId>.json, commits
  4. replies on the issue with the parsed stats, closes it, deploys to GitHub Pages
        ▼
omkarbhilare.com/cricket  (index.html renders data/season.json)
```

* **No server, no database, no admin.** Every match is a JSON file in `data/matches/`, so the history is in git. Submitting needs a free GitHub account.
* **Your portfolio is not touched.** Your user site (`ombhilare999.github.io`) already uses the custom domain `omkarbhilare.com`. GitHub Pages serves this `cricket` repo at `omkarbhilare.com/cricket/`.

## Rules for adding a match

A match is added only if:

1. the link is `https://cricclubs.com/<League>/fullScorecard.do?...&matchId=<n>` and the league is one of ours (Lakeshore or Mississauga Cricket League),
2. the scorecard shows the team **True Blue Falcons** by its exact name (`teamName` in `data/config.json`),
3. **every** True Blue Falcons player on the scorecard (batters, did-not-bat, bowlers) matches a roster name in `data/players.json` exactly, or one of that player's `aliases`. Case, extra spaces, apostrophes and markers like `(c)`, `(wk)`, `*` and `†` are ignored. Initials, nicknames and partial names are not accepted.
4. the match has not been added before.

If a real player's CricClubs name differs from the roster (for example `Hritik Advani` against roster `Hritik Kumar Advani`), the submission is rejected and the issue names them. Add the CricClubs spelling to that player's `aliases` (or add a new player), push, and submit again.

**Fallback:** go to GitHub → Actions → *Update site* → *Run workflow* and paste the link there.

## Fixing data

| Problem | Fix |
|---|---|
| A player fielded but neither batted nor bowled, and is missing from the card | Add `"extraPlayers": ["player-id"]` to that match's file in `data/matches/` |
| Wrong date | Add `"dateOverride": "2026-06-14"` to the match file |
| Roster or tier change | Edit `data/players.json` (`tier`: `full`, `half` or `none`) |
| Parser improved and you want to re-read old matches | `node scripts/ingest.mjs --url <link> --reparse` re-reads the raw page saved in `data/raw/` |

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
