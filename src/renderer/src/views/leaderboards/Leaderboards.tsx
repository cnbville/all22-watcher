import type { PositionGroup } from "@shared/types";
import { EmptyState } from "../../ui/EmptyState";
import { Segmented } from "../../ui/Segmented";
import { links, navigate } from "../../shell/router";
import { Screen } from "../../shell/Screen";
import { persist } from "../../shell/uiState";
import { Toolbar } from "../../shell/Toolbar";
import { SeasonGate, useSeasonReady } from "../shared/SeasonGate";

const GROUPS: PositionGroup[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "OL",
  "DL",
  "LB",
  "DB",
];
const NAMES: Record<string, string> = {
  QB: "Quarterbacks",
  RB: "Running Backs",
  WR: "Wide Receivers",
  TE: "Tight Ends",
  OL: "Offensive Line",
  DL: "Defensive Line",
  LB: "Linebackers",
  DB: "Defensive Backs",
};

/** Leaderboards placeholder (03 §7 fills it in): the position control and the "No grades yet" state. */
export function Leaderboards({ season, pos }: { season: number; pos: string }) {
  const ready = useSeasonReady(season);
  const group = (
    GROUPS.includes(pos as PositionGroup) ? pos : "QB"
  ) as PositionGroup;
  return (
    <Screen name="leaderboards">
      <Toolbar
        title="Leaderboards"
        subtitle={`${season} · ${NAMES[group]}`}
        windowTitle={`Leaderboards — ${season}`}
        center={
          ready && (
            <Segmented
              size="toolbar"
              value={group}
              label="Position"
              onChange={(g) => {
                persist("ui.leaders.pos", g);
                navigate(links.leaders(season, g), { replace: true });
              }}
              options={GROUPS.map((g) => ({
                value: g,
                label: g,
                title: NAMES[g],
              }))}
            />
          )
        }
      />
      <SeasonGate season={season}>
        <EmptyState
          icon="trophy"
          title="No grades yet"
          body="Grade players in the tape room and they’ll be ranked here."
          primary={{ label: "Open Film", run: () => navigate(links.film()) }}
        />
      </SeasonGate>
    </Screen>
  );
}
