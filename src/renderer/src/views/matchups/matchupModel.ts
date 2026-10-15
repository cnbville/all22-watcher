import { emptyTally, formatStat, gradeScore, mergeTally } from "@shared/stats";
import { TEAM_BY_ABBR } from "@shared/teams";
import type {
  GameInfo,
  GradeTally,
  MatchupData,
  MatchupSide,
  PositionGroup,
  RosterPlayer,
  SearchIndex,
  TeamSummary,
  UnitKey,
} from "@shared/types";
import { rankScore } from "../../ui/heat";

/** Matchups (03 §8): the pure parts, for the picker and the matchup page. */

export interface VersusValue {
  value: string | null;
  score: number | null;
  rank?: number | null;
  note?: string;
  neutral?: boolean;
}
export type Better = "left" | "right" | "equal" | null;

export const OFFENSE_GROUPS: PositionGroup[] = ["QB", "RB", "WR", "TE", "OL"];
export const DEFENSE_GROUPS: PositionGroup[] = ["DL", "LB", "DB"];

/** "League ranks" rows: center label, then the stat key on each side (03 §8.3). */
export const RANK_ROWS: { key: string; label: string }[] = [
  { key: "ppg", label: "Points / game" },
  { key: "epa", label: "EPA / play" },
  { key: "success", label: "Success rate" },
  { key: "ypp", label: "Yards / play" },
  { key: "passEpa", label: "Pass EPA" },
  { key: "rushEpa", label: "Rush EPA" },
  { key: "to", label: "Turnovers / game" },
  { key: "sacks", label: "Sacks / game" },
];

export const better = (l: number | null, r: number | null): Better =>
  l === null || r === null
    ? null
    : l === r
      ? "equal"
      : l > r
        ? "left"
        : "right";

const minus = (s: string) => s.replace(/^-/, "−");

/** One side of a league-rank row: its own rank and rank score, "—" when the team has no games yet. */
export function rankSide(
  summary: TeamSummary | null,
  side: "offense" | "defense",
  key: string,
): VersusValue {
  const s =
    summary && summary.games > 0
      ? summary[side].find((x) => x.key === key)
      : undefined;
  if (!s) return { value: null, score: null };
  return {
    value: minus(formatStat(s.value, s.format)),
    score: rankScore(s.rank),
    rank: s.rank,
    neutral: s.neutral,
  };
}

/** Tallies of several unit keys added together ("Receivers and tight ends"). */
export function unitTally(
  units: Partial<Record<UnitKey, GradeTally>>,
  keys: UnitKey[],
): GradeTally {
  return keys.reduce(
    (t, k) => (units[k] ? mergeTally(t, units[k]!) : t),
    emptyTally(),
  );
}

export function gradeSide(t: GradeTally): VersusValue {
  const g = gradeScore(t);
  return g === null
    ? { value: null, score: null }
    : { value: String(g), score: g, note: `${t.graded}` };
}

/** "Your grades" rows for one possession: offense units of one side against the matching defense units. */
export const GRADE_ROWS: {
  label: string;
  sub: string;
  off: UnitKey[];
  def: UnitKey[];
}[] = [
  {
    label: "Line of scrimmage",
    sub: "Offensive line · Defensive line",
    off: ["OL"],
    def: ["DL"],
  },
  {
    label: "Run game",
    sub: "Running backs · Linebackers",
    off: ["RB"],
    def: ["LB"],
  },
  {
    label: "Passing game",
    sub: "Receivers and tight ends · Defensive backs",
    off: ["WR", "TE"],
    def: ["DB"],
  },
  {
    label: "Quarterback",
    sub: "Quarterbacks · Whole defense",
    off: ["QB"],
    def: ["DEF"],
  },
  { label: "Overall", sub: "Offense · Defense", off: ["OFF"], def: ["DEF"] },
];

export interface WatchRow {
  player: RosterPlayer;
  tally: GradeTally;
  grade: number;
}

/** Players to watch on one unit side: up to 4 strengths (60+) and 2 weak spots (45 or less), 10+ graded snaps. */
export function playersToWatch(
  players: MatchupSide["players"],
  unit: "offense" | "defense",
): { strengths: WatchRow[]; weak: WatchRow[] } {
  const groups = unit === "offense" ? OFFENSE_GROUPS : DEFENSE_GROUPS;
  const pool = players
    .filter((p) => groups.includes(p.player.group) && p.tally.graded >= 10)
    .map((p) => ({ ...p, grade: gradeScore(p.tally) ?? 0 }));
  const strengths = pool
    .filter((p) => p.grade >= 60)
    .sort((a, b) => b.grade - a.grade || b.tally.graded - a.tally.graded)
    .slice(0, 4);
  const weak = pool
    .filter((p) => p.grade <= 45)
    .sort((a, b) => a.grade - b.grade || b.tally.graded - a.tally.graded)
    .slice(0, 2);
  return { strengths, weak };
}

export const hasGradedUnit = (
  players: MatchupSide["players"],
  unit: "offense" | "defense",
) =>
  players.some(
    (p) =>
      (unit === "offense" ? OFFENSE_GROUPS : DEFENSE_GROUPS).includes(
        p.player.group,
      ) && p.tally.graded > 0,
  );

const OFF_LEADERS = ["passing_yards", "rushing_yards", "receiving_yards"];
const DEF_LEADERS = [
  "def_sacks",
  "tackles",
  "def_interceptions",
  "def_pass_defended",
];

/** "Stat leaders" for a unit side with no grades: "3,858 pass yds". */
export function statLeaders(side: MatchupSide, unit: "offense" | "defense") {
  const keys = unit === "offense" ? OFF_LEADERS : DEF_LEADERS;
  return side.statLeaders
    .filter((l) => keys.includes(l.key))
    .map((l) => ({
      ...l,
      text: `${Math.round(l.value).toLocaleString("en-US")} ${l.label}`,
    }));
}

export const played = (g: Pick<GameInfo, "homeScore" | "awayScore">) =>
  g.homeScore !== null && g.awayScore !== null;

/** "PHI won 24–20", "DAL won 27–24", "Tied 20–20". */
export function resultLine(g: GameInfo): string {
  if (!played(g)) return "";
  const h = g.homeScore!;
  const a = g.awayScore!;
  if (h === a) return `Tied ${h}–${a}`;
  return h > a ? `${g.homeTeam} won ${h}–${a}` : `${g.awayTeam} won ${a}–${h}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export function dayLabel(gameday: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(gameday);
  if (!m) return gameday;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export const weekName = (g: Pick<GameInfo, "week" | "gameType">) =>
  g.gameType === "WC"
    ? "Wild Card"
    : g.gameType === "DIV"
      ? "Divisional"
      : g.gameType === "CON"
        ? "Conference"
        : g.gameType === "SB"
          ? "Super Bowl"
          : `Week ${g.week}`;

/** The next meeting this season (unplayed), else the latest played meeting, else null. */
export function keyMeeting(
  data: Pick<MatchupData, "meetings" | "season">,
): { game: GameInfo; next: boolean; clipCount: number } | null {
  const thisSeason = data.meetings.filter((m) => m.game.season === data.season);
  const next = [...thisSeason].reverse().find((m) => !played(m.game));
  if (next) return { game: next.game, next: true, clipCount: next.clipCount };
  const last = data.meetings.find((m) => played(m.game));
  return last
    ? { game: last.game, next: false, clipCount: last.clipCount }
    : null;
}

/** Toolbar subtitle (03 §8.3): "Week 12 · Sun, Nov 23", "Week 1 · PHI won 24–20" or "No game in 2025". */
export function matchupSubtitle(
  data: Pick<MatchupData, "meetings" | "season">,
): string {
  const k = keyMeeting(data);
  if (!k) return `No game in ${data.season}`;
  if (k.next) return `${weekName(k.game)} · ${dayLabel(k.game.gameday)}`;
  return `${k.game.season !== data.season ? `${k.game.season} ` : ""}${weekName(k.game)} · ${resultLine(k.game)}`;
}

/** Header center lines: "Week 12 · Sun, Nov 23" / "at Philadelphia"; or "Week 1 · Final" / "PHI 24–20". */
export function centerLines(
  data: Pick<MatchupData, "meetings" | "season">,
): [string, string] | null {
  const k = keyMeeting(data);
  if (!k) return null;
  const g = k.game;
  if (k.next) {
    const home = TEAM_BY_ABBR[g.homeTeam];
    return [
      `${weekName(g)} · ${dayLabel(g.gameday)}`,
      `at ${home ? home.name.replace(` ${home.nickname}`, "") : g.homeTeam}`,
    ];
  }
  const h = g.homeScore!;
  const a = g.awayScore!;
  const lead = h >= a ? `${g.homeTeam} ${h}–${a}` : `${g.awayTeam} ${a}–${h}`;
  return [
    `${g.season !== data.season ? `${g.season} · ` : ""}${weekName(g)} · Final`,
    lead,
  ];
}

// ── Picker ────────────────────────────────────────────────────────────────

export type IndexGame = SearchIndex["games"][number];

/** Today as "YYYY-MM-DD" in local time. */
export const todayIso = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** The week of the earliest unplayed game (by date), else the last week. */
export function defaultWeek(games: IndexGame[], today: string): number | null {
  if (!games.length) return null;
  const upcoming = games
    .filter((g) => g.gameday >= today)
    .sort((a, b) => a.gameday.localeCompare(b.gameday));
  if (upcoming.length) return upcoming[0].week;
  return Math.max(...games.map((g) => g.week));
}

export function weeksOf(games: IndexGame[]): number[] {
  return [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
}

/** The week's games, those with a My Teams team first, then by date. */
export function weekGames(
  games: IndexGame[],
  week: number,
  myTeams: string[],
): IndexGame[] {
  const mine = (g: IndexGame) =>
    myTeams.includes(g.homeTeam) || myTeams.includes(g.awayTeam);
  return games
    .filter((g) => g.week === week)
    .sort(
      (a, b) =>
        Number(mine(b)) - Number(mine(a)) ||
        a.gameday.localeCompare(b.gameday) ||
        a.homeTeam.localeCompare(b.homeTeam),
    );
}

/** Which team goes on the left: a My Teams team (the first in My Teams order), else the home team. */
export function orient(
  g: { homeTeam: string; awayTeam: string },
  myTeams: string[],
): [string, string] {
  const hi = myTeams.indexOf(g.homeTeam);
  const ai = myTeams.indexOf(g.awayTeam);
  if (ai >= 0 && (hi < 0 || ai < hi)) return [g.awayTeam, g.homeTeam];
  return [g.homeTeam, g.awayTeam];
}

export interface RecentMatchup {
  left: string;
  right: string;
  season: number;
}

/** Adds a matchup to the front of the recent list (6 at most, no duplicates). */
export function pushRecent(
  list: RecentMatchup[],
  m: RecentMatchup,
): RecentMatchup[] {
  return [
    m,
    ...list.filter(
      (r) =>
        !(r.left === m.left && r.right === m.right && r.season === m.season),
    ),
  ].slice(0, 6);
}

/** Parses `ui.matchup.last` ("PHI|DAL"). */
export function parseLast(raw: string | null): [string, string] | null {
  const m = /^([A-Z]{2,3})\|([A-Z]{2,3})$/.exec(raw ?? "");
  return m && TEAM_BY_ABBR[m[1]] && TEAM_BY_ABBR[m[2]] && m[1] !== m[2]
    ? [m[1], m[2]]
    : null;
}
