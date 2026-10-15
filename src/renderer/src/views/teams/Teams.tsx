import { useCallback, useEffect, useMemo, useState } from "react";
import { DIVISIONS, TEAMS } from "@shared/teams";
import type { Team, TeamSummary } from "@shared/types";
import { api } from "../../api";
import { RankBadge } from "../../ui/Badge";
import { EmptyState } from "../../ui/EmptyState";
import { Segmented } from "../../ui/Segmented";
import { type Column, type SortState, Table } from "../../ui/Table";
import { TeamChip } from "../../ui/TeamChip";
import { Tile } from "../../ui/Tile";
import { showMenu, teamMenu } from "../../shell/contextMenus";
import { useDataEvent } from "../../shell/dataEvents";
import { links, navigate } from "../../shell/router";
import {
  LargeTitle,
  LoadError,
  Screen,
  Section,
  useScrollRestore,
} from "../../shell/Screen";
import { Toolbar } from "../../shell/Toolbar";
import { SeasonGate, useSeasonReady } from "../shared/SeasonGate";
import "./teams.css";

/** Teams (03 §4, basic): all 32 by division, or standings. Replaces v1 Home's division grid. */

type View = "divisions" | "standings";
const VIEW_KEY = (season: number) => `ui.route.teams.${season}.view`;

function readView(season: number): View {
  try {
    return sessionStorage.getItem(VIEW_KEY(season)) === "standings"
      ? "standings"
      : "divisions";
  } catch {
    return "divisions";
  }
}

const city = (t: Team) => t.name.replace(` ${t.nickname}`, "");
const record = (s?: TeamSummary) =>
  s ? `${s.wins}–${s.losses}${s.ties ? `–${s.ties}` : ""}` : "0–0";
const diff = (s?: TeamSummary) => {
  const d = s ? s.pointsFor - s.pointsAgainst : 0;
  return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0";
};
const pctOf = (s?: TeamSummary) =>
  s && s.games
    ? (s.wins + s.ties / 2) / Math.max(1, s.wins + s.losses + s.ties)
    : 0;

export function Teams({ season }: { season: number }) {
  const [view, setView] = useState<View>(() => readView(season));
  const [q, setQ] = useState("");
  const changeView = (v: View) => {
    setView(v);
    try {
      sessionStorage.setItem(VIEW_KEY(season), v);
    } catch {
      // Not remembered.
    }
  };
  const ready = useSeasonReady(season);
  return (
    <Screen name="teams">
      <Toolbar
        title="Teams"
        subtitle={`${season} season`}
        windowTitle={`Teams — ${season}`}
        collapsesLargeTitle
        center={
          ready && (
            <Segmented
              size="toolbar"
              value={view}
              onChange={changeView}
              label="View"
              options={[
                {
                  value: "divisions",
                  label: "Divisions",
                  test: "teams-view-divisions",
                },
                {
                  value: "standings",
                  label: "Standings",
                  test: "teams-view-standings",
                },
              ]}
            />
          )
        }
        search={
          ready
            ? {
                placeholder: "Search teams",
                value: q,
                onChange: setQ,
                test: "teams-search",
              }
            : undefined
        }
      />
      <SeasonGate season={season}>
        <TeamsContent season={season} view={view} q={q} />
      </SeasonGate>
    </Screen>
  );
}

function TeamsContent({
  season,
  view,
  q,
}: {
  season: number;
  view: View;
  q: string;
}) {
  const [summaries, setSummaries] = useState<Map<string, TeamSummary> | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    api.teamSummaries(season).then(
      (s) => setSummaries(new Map(s.map((x) => [x.team, x]))),
      (e) => setError(e),
    );
  }, [season]);
  useEffect(load, [load]);
  useDataEvent("season", load);
  useScrollRestore(summaries !== null);
  const needle = q.trim().toLowerCase();
  const match = (t: Team) =>
    !needle ||
    t.abbr.toLowerCase().includes(needle) ||
    t.name.toLowerCase().includes(needle);
  const shown = TEAMS.filter(match);
  if (error) return <LoadError what="the teams" error={error} retry={load} />;
  if (!summaries) return null;
  if (!shown.length)
    return (
      <EmptyState
        icon="search"
        title={`No Results for “${q.trim()}”`}
        body="Check the spelling or try a team, player or week."
      />
    );
  return (
    <>
      <LargeTitle>Teams</LargeTitle>
      {view === "divisions" ? (
        <Divisions season={season} teams={shown} summaries={summaries} />
      ) : (
        <Standings season={season} teams={shown} summaries={summaries} />
      )}
    </>
  );
}

function Divisions({
  season,
  teams,
  summaries,
}: {
  season: number;
  teams: Team[];
  summaries: Map<string, TeamSummary>;
}) {
  return (
    <>
      {(["AFC", "NFC"] as const).map((conf) => {
        const divs = DIVISIONS.filter((d) => d.startsWith(conf)).filter((d) =>
          teams.some((t) => t.division === d),
        );
        if (!divs.length) return null;
        return (
          <Section key={conf} title={conf}>
            <div className="teams-divisions">
              {divs.map((div) => (
                <div key={div} className="teams-division">
                  <div className="teams-division__title">
                    {div.replace(`${conf} `, "")}
                  </div>
                  {teams
                    .filter((t) => t.division === div)
                    .map((t) => {
                      const s = summaries.get(t.abbr);
                      return (
                        <Tile
                          key={t.abbr}
                          test="team-tile"
                          className="team-tile"
                          onOpen={() => navigate(links.team(season, t.abbr))}
                          onContextMenu={(e) =>
                            void showMenu(e, teamMenu(season, t.abbr))
                          }
                        >
                          <TeamChip abbr={t.abbr} size="md" />
                          <div className="team-tile__names">
                            <div className="team-tile__nickname">
                              {t.nickname}
                            </div>
                            <div className="team-tile__city">{city(t)}</div>
                          </div>
                          <div className="team-tile__record">
                            <div className="team-tile__wl">{record(s)}</div>
                            <div className="team-tile__diff">{diff(s)}</div>
                          </div>
                        </Tile>
                      );
                    })}
                </div>
              ))}
            </div>
          </Section>
        );
      })}
    </>
  );
}

function rankOf(s: TeamSummary | undefined, side: "offense" | "defense") {
  const list = s?.[side] ?? [];
  return list.find((x) => x.key.includes("epa")) ?? list[0];
}

function Standings({
  season,
  teams,
  summaries,
}: {
  season: number;
  teams: Team[];
  summaries: Map<string, TeamSummary>;
}) {
  const [sort, setSort] = useState<SortState>({ column: "pct", dir: "desc" });
  const [sel, setSel] = useState<string | null>(null);
  const ties = [...summaries.values()].some((s) => s.ties > 0);
  const columns: Column<Team>[] = [
    {
      id: "team",
      label: "Team",
      flex: 3,
      minWidth: 220,
      render: (t) => (
        <span className="standings-team">
          <TeamChip abbr={t.abbr} />
          <a
            className="link"
            onClick={(e) => (
              e.stopPropagation(),
              navigate(links.team(season, t.abbr))
            )}
          >
            {t.nickname}
          </a>
          <span className="c-label-3 t-callout">{city(t)}</span>
        </span>
      ),
    },
    {
      id: "w",
      label: "W",
      width: 40,
      numeric: true,
      sortable: true,
      render: (t) => summaries.get(t.abbr)?.wins ?? 0,
    },
    {
      id: "l",
      label: "L",
      width: 40,
      numeric: true,
      sortable: true,
      render: (t) => summaries.get(t.abbr)?.losses ?? 0,
    },
    ...(ties
      ? [
          {
            id: "t",
            label: "T",
            width: 40,
            numeric: true,
            render: (t: Team) => summaries.get(t.abbr)?.ties ?? 0,
          },
        ]
      : []),
    {
      id: "pct",
      label: "Pct",
      width: 56,
      numeric: true,
      sortable: true,
      render: (t) => pctOf(summaries.get(t.abbr)).toFixed(3).replace(/^0/, ""),
    },
    {
      id: "pf",
      label: "PF",
      width: 56,
      numeric: true,
      sortable: true,
      render: (t) => summaries.get(t.abbr)?.pointsFor ?? 0,
    },
    {
      id: "pa",
      label: "PA",
      width: 56,
      numeric: true,
      sortable: true,
      render: (t) => summaries.get(t.abbr)?.pointsAgainst ?? 0,
    },
    {
      id: "diff",
      label: "Diff",
      width: 56,
      numeric: true,
      sortable: true,
      render: (t) => diff(summaries.get(t.abbr)),
    },
    {
      id: "off",
      label: "Off. rank",
      width: 80,
      align: "right",
      render: (t) => {
        const r = rankOf(summaries.get(t.abbr), "offense");
        return r ? (
          <RankBadge rank={r.rank} title={`${r.label} · ${r.rank}`} />
        ) : (
          "—"
        );
      },
    },
    {
      id: "def",
      label: "Def. rank",
      width: 80,
      align: "right",
      render: (t) => {
        const r = rankOf(summaries.get(t.abbr), "defense");
        return r ? (
          <RankBadge rank={r.rank} title={`${r.label} · ${r.rank}`} />
        ) : (
          "—"
        );
      },
    },
  ];
  const value = (t: Team): number => {
    const s = summaries.get(t.abbr);
    switch (sort.column) {
      case "w":
        return s?.wins ?? 0;
      case "l":
        return s?.losses ?? 0;
      case "pf":
        return s?.pointsFor ?? 0;
      case "pa":
        return s?.pointsAgainst ?? 0;
      case "diff":
        return s ? s.pointsFor - s.pointsAgainst : 0;
      default:
        return pctOf(s) * 1000 + (s ? s.pointsFor - s.pointsAgainst : 0) / 1000;
    }
  };
  const rows = useMemo(() => {
    const order = DIVISIONS;
    return [...teams].sort(
      (a, b) =>
        order.indexOf(a.division) - order.indexOf(b.division) ||
        (value(a) - value(b)) * (sort.dir === "asc" ? 1 : -1),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, summaries, sort]);
  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(t) => t.abbr}
      sort={sort}
      onSort={setSort}
      selection={sel}
      onSelect={setSel}
      onOpen={(t) => navigate(links.team(season, t.abbr))}
      onContextMenu={(t, e) => void showMenu(e, teamMenu(season, t.abbr))}
      groupBy={(t) => t.division}
      groupLabel={(g) => g}
      rowTest="teams-standings-row"
      typeSelect={(t) => t.nickname}
    />
  );
}
