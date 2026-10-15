# All-22 Watcher

A Mac app for watching and grading NFL All-22 film. Pick a team, see its season at a glance, import a game's clips, and grade every player snap by snap with the keyboard. Everything is saved locally on your Mac.

## What it does

- **A real Mac app.** A translucent sidebar (Home, Film, Teams, Leaderboards, Matchups, your teams and your cut-ups), a toolbar with back and forward, a full menu bar where every command shows its shortcut, right-click menus everywhere, Settings in its own window (⌘,), Quick Open (⌘K) to jump to any team, player, game or cut-up, and ⌘/ to see every shortcut.
- **Teams and seasons.** All 32 teams by division or in standings. Each team page has Overview, Games, Roster and Units sections: regular-season efficiency ranked against the league, the schedule with your film status, the roster with snaps and your grades, and your unit grades game by game.
- **Film import.** Drop a game's clips (or their folder) on the window. Clips are matched to the official play-by-play in filename order per camera angle, and clip lengths are compared with the plays to flag clips that look matched to the wrong play. MKV, AVI and other formats are converted with the ffmpeg built into the app. Set a **watch folder** and new games are imported on their own.
- **Tape room.** Sideline and end zone **side by side in sync**, frame stepping, slow motion, looping, a **snap point** per clip (replays, reels and exports start there), and drawing tools (pen, arrows, circles, boxes, text, spotlight) that stay on screen for a time range. A searchable play list with filter tokens, and **Film Only** (⇧⌘F) to fill the window with video.
- **Grading.** +, 0 or − for each player on each snap with the keyboard, position tags, notes, your own charting fields, and a **critical-play** mark (!) that counts the grade double. **Player Focus** (G) walks one player through every snap he played.
- **Player pages.** Overview, Film (a reel of every graded snap with its EPA), Splits (by down, quarter, formation, personnel, coverage and run or pass; by opponent with opponent strength; grade against EPA), Game Log, and Career (grade trend across every downloaded season).
- **Leaderboards and matchups.** Your grades ranked by position across every team you've graded, and a matchup page that sets one team's units against an opponent's before a game.
- **Cut-ups.** Save plays from any game into a cut-up, or make a smart cut-up from rules ("3rd-down pressures", "every flagged play"), and play it back any time.
- **Exports.** One video file of a reel or cut-up with grades and drawings burned in (⌘E), a PDF scouting report per player, and CSVs of grades and leaderboards.
- **Fresh data.** During the season, the app updates the current season's data on launch.

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

1. **Download a season.** On first launch, pick a season from the season menu at the top of the sidebar and click **Download**. It pulls about 60 MB of free public data from [nflverse](https://github.com/nflverse/nflverse-data) and works offline afterwards. During the season the app updates it on launch; **File › Update Season Data** (⌥⌘R) does it by hand.
2. **Open a team** (⌘3), go to **Games**, and click **Import Film…** next to a game. Or drop the clips on the window.
3. **Choose the clips** for that game, or the folder they're in. Name or file them so they sort in game order (`Play 1.mp4`, `Play 2.mp4`, …). For two angles, put them in folders or names containing `sideline`/`SL` and `end zone`/`EZ`. Folders per quarter or half (`Q1`…`Q4`, `OT`, `First Quarter`, `1st Half`) are kept in game order even when each one restarts at 1, whether they sit inside the angle folders or hold them.
4. **Check the matches.** The app guesses whether your clips include special teams and penalty no-plays from how many clips there are; flip the checkboxes if it guessed wrong. If one clip is missing mid-game, click the arrow on the first wrong row to slide everything after it.
5. **Grade.** Watch the snap, then go down the player list with `=` (plus), `0`, and `-` (minus). Each grade moves you to the next player. Press `↓` for the next play.

Clips play in MP4, MOV, M4V, or WebM. Other formats (MKV, AVI, TS, …) are converted to MP4 copies with the ffmpeg built into the app; your originals aren't touched.

**Watch folder.** In **Settings › Film & Import**, choose a folder. Each game you copy into it as its own subfolder (named like `DAL at PHI` or `2025 Wk 1 DAL @ PHI`, with angle subfolders inside) is matched to the schedule and imported once its files stop changing. You get a notification and the game appears under **Film**.

### Hotkeys

Every command is in the menu bar with its shortcut, and **Help › Keyboard Shortcuts** (⌘/) lists them all. The tape room's main keys:

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Step one frame (`⇧` jumps a second) |
| `↑` `↓` | Previous / next play (`⌥` skips to ungraded plays) |
| `B` / `⇧B` | Replay from the snap / set the snap here (`⌥←` `⌥→` nudge it) |
| `[` `]` | Slower / faster |
| `L`, `M` | Loop, sound |
| `A`, `S` | Next camera angle, side-by-side angles |
| `1`–`9`, `Tab` | Select a player |
| `=` `0` `-` | Grade +, 0, − (`⇧0` grades everyone left 0) |
| `!` | Mark the grade critical (counts double) |
| `⌫` | Clear the grade |
| `G` | Player Focus |
| `D` | Draw (`Z` undo, `C` clear) |
| `F`, `N` | Flag the play, write a play note |
| `⌘D` | Add the play to a cut-up |
| `⇧⌘F` | Film Only |

### Where your data lives

Grades, notes, tags, and settings are in one SQLite file, `grades.sqlite`, in `~/Library/Application Support/All-22 Watcher/`, next to the downloaded nflverse data. Your video files stay where they are; the app only stores their paths. Back up that folder to keep your grades. **Settings › Data** shows it in Finder. Opening a database from the first version upgrades it in place and keeps a copy of the original next to it (`grades.sqlite.v1-backup`).

## How grades are scored

Each graded snap is +, 0, or −. A player's grade is `50 + 50 × (plus − minus) / graded snaps`, so an all-plus game is 100, an all-minus game is 0, and a mix of zeros is 50. A snap marked critical counts twice, in both the top and the bottom of that fraction. Tags don't change the number, but a positive or negative tag sets a + or – when the snap has no grade yet.

## Development

```sh
npm run typecheck
npm test                                   # unit tests
npm run build && npm run smoke             # launch the app and click through a full session
NFLVERSE_MIRROR=/path/to/csvs npm test     # also test the nflverse import against real files
```

- `src/main`: Electron main process. `nflverse.ts` downloads and trims the public data, `db.ts` is the SQLite store (sql.js), `library.ts` joins the two, `windows.ts`, `menu.ts` and `shell.ts` are the windows, menu bar and native integration, `watch.ts` is the watch folder, `seasonUpdate.ts` the in-season updates, `exportVideo.ts` the video export, and `index.ts` wires up the `tape://` video protocol and IPC.
- `src/preload`: exposes the typed API in `src/shared/api.ts` and the shell bridge in `src/shared/shell.ts` to the window.
- `src/renderer`: the React UI. `shell/` is the sidebar, toolbar, router and commands, `ui/` the components and design tokens, `views/` one folder per screen, `settings/` the Settings window.
- `src/shared`: types, commands and shortcuts, team data, clip matching, cut-up rules, splits and stat math used by both sides.

`npm run dist` downloads the ffmpeg build for each Mac architecture (`scripts/fetch-ffmpeg.mjs`) and bundles it. Set `ALL22_USER_DATA` to keep data in another folder, `ALL22_NFLVERSE_MIRROR` to read nflverse files from a local folder instead of downloading them, or `ALL22_FFMPEG` to use a different ffmpeg.

Data: play-by-play, participation, rosters, and stats from [nflverse](https://github.com/nflverse/nflverse-data).
