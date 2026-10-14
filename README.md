# All-22 Watcher

A Mac app for watching and grading NFL All-22 film. Pick a team, see its season at a glance, import a game's clips, and grade every player snap by snap with the keyboard. Everything is saved locally on your Mac.

## What it does

- **Teams and seasons.** All 32 teams by division with records. Each team page shows offense and defense efficiency (EPA per play, success rate, points, turnovers, sacks) ranked against the league, the schedule with your film status, and the roster with snap counts and your grades.
- **Film import.** Point it at a game's clips (one clip per play, or a folder of them). Clips are matched to the official play-by-play in filename order, sideline and end zone angles separately. Check the matches, slide them if a clip is missing, and save.
- **Tape room.** Frame-by-frame stepping, slow motion, looping, switching angles, and drawing on the film. Filter plays by side, down, quarter, play type, formation, personnel, coverage, or text. Every play shows down and distance, the result, EPA, and (when nflverse has published it) formation, personnel, box count, pass rushers, coverage, and pressure.
- **Grading.** +, 0, or – for each player on each snap, plus position-specific tags (like "Pass pro win" or "Missed tackle"), per-player notes, play notes, and your own charting fields (coverage shell, run concept, and so on). When nflverse has the on-field lineups, the 11 players on the field are listed automatically; otherwise star the players you're studying.
- **Player pages.** Season stats and game log, snaps, your grade (0–100, where 50 is neutral), grade by game, tag counts, and a film reel of every graded snap that you can filter by grade or tag.
- **Exports.** A PDF scouting report per player and a CSV of a team's grades.

## Install

### Download the app

1. Open the repo's **Actions** tab, pick the latest green **Build** run, and at the bottom of the page download **All-22-Watcher-mac-apple-silicon** (M1 and newer) or **All-22-Watcher-mac-intel**.
2. Unzip it, open the `.dmg`, and drag **All-22 Watcher** into Applications.
3. The app isn't signed by Apple, so the first time, right-click it in Applications and choose **Open**, then **Open** again. If macOS still refuses, run `xattr -dr com.apple.quarantine "/Applications/All-22 Watcher.app"` in Terminal.

### Or build it yourself

You need [Node.js](https://nodejs.org) 22 or newer.

```sh
npm install
npm run dev      # run the app with live reload
npm run dist     # build dist/*.dmg
```

## Using it

1. **Download a season.** On first launch, pick a season and click **Download**. It pulls about 60 MB of free public data from [nflverse](https://github.com/nflverse/nflverse-data) and works offline afterwards. Click **Update** during the season to pick up new games.
2. **Open a team** and click **Import film** next to a game.
3. **Choose the clips** for that game, or the folder they're in. Name or file them so they sort in game order (`Play 1.mp4`, `Play 2.mp4`, …). For two angles, put them in folders or names containing `sideline`/`SL` and `end zone`/`EZ`.
4. **Check the matches.** The app guesses whether your clips include special teams and penalty no-plays from how many clips there are; flip the checkboxes if it guessed wrong. If one clip is missing mid-game, click the arrow on the first wrong row to slide everything after it.
5. **Grade.** Watch the snap, then go down the player list with `=` (plus), `0`, and `-` (minus). Each grade moves you to the next player. Press `↓` for the next play.

Clips play in MP4, MOV, M4V, or WebM. Other formats (MKV, AVI) need converting first.

### Hotkeys

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Step one frame (`⇧` jumps a second) |
| `↑` `↓`, `Enter` | Previous / next play |
| `B` | Back to the snap |
| `[` `]` | Slower / faster |
| `L` | Loop on or off |
| `A` | Switch camera angle |
| `1`–`9`, `Tab` | Select a player |
| `=` `0` `-` | Grade +, 0, – |
| `⌫` | Clear the grade |
| `Q`…`P` | Toggle the selected player's tags |
| `D` | Draw on the film (`Z` undo, `C` clear) |
| `F` | Flag the play |
| `N` | Write a play note |
| `?` | Show all hotkeys |

### Where your data lives

Grades, notes, tags, and settings are in one SQLite file, `grades.sqlite`, in `~/Library/Application Support/All-22 Watcher/`, next to the downloaded nflverse data. Your video files stay where they are; the app only stores their paths. Back up that folder to keep your grades. **Settings → Show in Finder** opens it.

## How grades are scored

Each graded snap is +, 0, or –. A player's grade is `50 + 50 × (plus − minus) / graded snaps`, so an all-plus game is 100, an all-minus game is 0, and a mix of zeros is 50. Tags don't change the number, but a positive or negative tag sets a + or – when the snap has no grade yet.

## Development

```sh
npm run typecheck
npm test                                   # unit tests
npm run build && npm run smoke             # launch the app and click through a full session
NFLVERSE_MIRROR=/path/to/csvs npm test     # also test the nflverse import against real files
```

- `src/main`: Electron main process. `nflverse.ts` downloads and trims the public data, `db.ts` is the SQLite store (sql.js), `library.ts` joins the two, `index.ts` wires up windows, the `tape://` video protocol, and IPC.
- `src/preload`: exposes the typed API in `src/shared/api.ts` to the window.
- `src/renderer`: the React UI.
- `src/shared`: types, team data, clip matching, and stat math used by both sides.

Set `ALL22_USER_DATA` to keep data in another folder, or `ALL22_NFLVERSE_MIRROR` to read nflverse files from a local folder instead of downloading them.

Data: play-by-play, participation, rosters, and stats from [nflverse](https://github.com/nflverse/nflverse-data).
