# True Blue Falcons: season stats

A static stats site for the True Blue Falcons cricket club, served at **omkarbhilare.com/cricket**. For each player it shows matches played against their quota (full = 16, half = 8, out of 24), balls faced, batting opportunities, balls bowled and bowling opportunities, so the workload can be shared fairly. It covers both tournaments, Lakeshore and the Mississauga Cricket League.

## Two pages

* **`/cricket/`** is for the whole squad: top run-scorers, wicket-takers, highest score and best bowling, then full batting and bowling tables and the match list.
* **`/cricket/admin/`** is password protected. It has everything above plus quotas, batting/bowling opportunities and workload, and it is where matches are added.

The password check runs in the browser. The stats data itself (`data/*.json`) is public, so the password keeps people out of the admin tools, not out of the numbers.

## Adding a match (admin)

```
/cricket/admin/ → paste the CricClubs full scorecard link → "Open scorecard"
        │ CricClubs opens in a new tab (in your own browser, so its bot check lets you in)
        ▼
click the "Send to TBF" bookmark on that tab → the page comes back to the admin tab
        ▼
the admin page parses it, checks the rules and shows the stats
(unknown names: pick who they are; the CricClubs spelling is saved as an alias)
        ▼
"Save match" → one commit to main: data/matches/<id>.json, data/season.json,
data/raw/<id>.scorecard.html (and data/players.json if names were linked)
        ▼
push → GitHub Actions "Deploy site" → omkarbhilare.com/cricket updates in about a minute
```

CricClubs sits behind Cloudflare's bot protection, so neither GitHub Actions nor the website can download a scorecard from the link alone. The bookmark sends the page from your browser tab instead. Without a bookmarks bar (on a phone), save the scorecard page as HTML and choose the file on the admin page.

**One-time setup**

1. Open `/cricket/admin/`, unlock with the password, and drag **Send to TBF** to your bookmarks bar.
2. Create a GitHub [fine-grained token](https://github.com/settings/personal-access-tokens/new): Repository access *only* `ombhilare999/cricket`, Permissions → *Contents: Read and write*. Paste it under **Saving** and press **Connect**. The admin page encrypts it with the admin password (`data/admin-key.json`), so anyone with the password can save matches from any device.

**Changing the password:** `npm run set-admin-password` (asks for the new password and the token), then commit `data/admin-key.json`.

> The encrypted token is public, and the password only slows down guessing (PBKDF2, 600k rounds). A short password like `TBF1234` can be cracked offline. Keep the token limited to this repository. If it leaks, revoke it on GitHub and connect a new one.

## Rules for adding a match

A match is added only if:

1. the link is `https://(www.)cricclubs.com/<League>/fullScorecard.do?...matchId=<n>` and the league is one of ours (Lakeshore or Mississauga Cricket League),
2. the scorecard shows the team **True Blue Falcons** by its exact name (`teamName` in `data/config.json`),
3. **every** True Blue Falcons player on the scorecard (batters, did-not-bat, bowlers) matches a roster name in `data/players.json` exactly, or one of that player's `aliases`. Case, extra spaces, apostrophes and markers like `(c)`, `(wk)`, `*` and `†` are ignored. Anything else is linked by hand on the admin page.
4. the match has not been added before.

## Fixing data

| Problem | Fix |
|---|---|
| A player fielded but neither batted nor bowled, and is missing from the card | Add `"extraPlayers": ["player-id"]` to that match's file in `data/matches/` |
| Wrong date | Add `"dateOverride": "2026-06-14"` to the match file |
| Roster or tier change | Edit `data/players.json` (`tier`: `full`, `half` or `none`) |
| Player only fielded, at the time of adding | Tick them under *Also played* on the admin page before saving |
| Parser improved and you want to re-read old matches | `node scripts/ingest.mjs --url <link> --reparse` re-reads the raw page saved in `data/raw/` |

## Display rules

* **Full** members have top priority and a cap of 16 matches. **Half** members come second, with a cap of 8. **Per-match** (`none`) players are hidden unless the *Per-match players* switch is on.
* Each quota bar has a tick for where the player should be by now: `cap × team matches played ÷ 24`. A player more than one game behind it is marked **Due a game**.
* The season-places panel compares the places left (remaining matches × 11) with the games members are still owed. Member caps add up to 15×16 + 5×8 = **280**, but only 24×11 = **264** places exist, so the season starts 16 places short.
* **Batting opportunity** means the player batted in that match. **Bowling opportunity** means they bowled at least one legal ball.

## Development

```bash
npm install
npm test                          # parser tests (the same parser the admin page runs)
npm run serve                     # http://localhost:8080/cricket/
node scripts/ingest.mjs --url <link> --scorecard-html saved-page.html   # add a match from a saved page (CLI)
npm run set-admin-password        # change the admin password / token
```

Settings such as caps, total matches, tournaments, team aliases and the logo path live in `data/config.json`. To use the club's real logo, add the image to `assets/` and point `logo` at it.
