import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { StyleSheet, Text, View } from "react-native";

import { hopeMax } from "../../../../../src/lib/domain/characters";
import { api, type Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type as textType } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { PanelBoundary, QueryLoading } from "./chrome";
import { RestLauncher } from "./rests";

export type PartyMember = FunctionReturnType<typeof api.characters.partySummary>[number];
type ResourceName = "hp" | "stress" | "hope";

export function PartyBlock({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  return (
    <PanelBoundary title="The Party">
      <PartyQuery campaignId={campaignId} isGm={isGm} />
    </PanelBoundary>
  );
}

function PartyQuery({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const party = useQuery(api.characters.partySummary, { campaignId });
  return (
    <View style={styles.block}>
      <PartySection isGm={isGm} party={party} />
      <PanelBoundary title="Rest">
        <RestLauncher campaignId={campaignId} isGm={isGm} party={party} />
      </PanelBoundary>
    </View>
  );
}

export function PartySection({ isGm, party }: { isGm: boolean; party: PartyMember[] | undefined }) {
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.heading}>
        The Party
      </Text>
      <QueryLoading label="Loading the party" value={party} />
      {party === undefined ? null : party.length === 0 ? (
        <Text style={styles.empty}>No characters yet. Open the Party tab to create the first hero.</Text>
      ) : (
        party.map((character) => <PartyCard character={character} isGm={isGm} key={character._id} />)
      )}
    </View>
  );
}

function PartyCard({ character, isGm }: { character: PartyMember; isGm: boolean }) {
  const { sheet } = character;
  const dead = character.status === "dead";
  const canEdit = character.canEdit && !character.corrupt;
  return (
    <View accessibilityLabel={dead ? `${sheet.name} (fallen)` : sheet.name} style={styles.card}>
      <Text style={styles.name}>{sheet.name}</Text>
      <Text style={styles.meta}>{`Level ${sheet.level}`}</Text>
      {dead ? <Text style={styles.fallen}>Fallen</Text> : null}
      {sheet.levelUpPending ? <Text style={styles.meta}>Level up ready</Text> : null}
      <View style={styles.tracks}>
        <Track
          canStep={canEdit && !dead}
          character={character}
          label="Hit Points"
          max={sheet.hpMax}
          resource="hp"
          value={sheet.hp}
        />
        <Track
          canStep={canEdit && !dead}
          character={character}
          label="Stress"
          max={sheet.stressMax}
          resource="stress"
          value={sheet.stress}
        />
        <Track
          canStep={canEdit && !dead}
          character={character}
          label="Hope"
          max={hopeMax(sheet.scars, sheet.hopeSlotBonus ?? 0)}
          resource="hope"
          value={sheet.hope}
        />
      </View>
      <StatusActions canEdit={canEdit} character={character} isGm={isGm} />
    </View>
  );
}

function Track({
  canStep,
  character,
  label,
  max,
  resource,
  value,
}: {
  canStep: boolean;
  character: PartyMember;
  label: string;
  max: number;
  resource: ResourceName;
  value: number;
}) {
  const writes = useWritesEnabled();
  const adjust = useMutation(api.characters.adjustResource);
  const noun = resource === "hope" ? "Hope" : resource === "hp" ? "Hit Point" : "Stress";
  const plus = resource === "hope" ? `Gain one Hope for ${character.sheet.name}` : `Mark one ${noun} for ${character.sheet.name}`;
  const minus =
    resource === "hope" ? `Spend one Hope for ${character.sheet.name}` : `Clear one ${noun} for ${character.sheet.name}`;
  const atTop = resource !== "stress" && value >= max;

  function step(delta: number) {
    void adjust({ characterId: character._id, resource, delta });
  }

  return (
    <View style={styles.track}>
      <Text style={styles.meta}>{`${label} ${value} of ${max}`}</Text>
      {canStep ? (
        <View style={styles.row}>
          <Button accessibilityLabel={minus} disabled={!writes || value <= 0} onPress={() => step(-1)} variant="outline">
            −
          </Button>
          <Button accessibilityLabel={plus} disabled={!writes || atTop} onPress={() => step(1)} variant="outline">
            +
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function StatusActions({
  canEdit,
  character,
  isGm,
}: {
  canEdit: boolean;
  character: PartyMember;
  isGm: boolean;
}) {
  const writes = useWritesEnabled();
  const setStatus = useMutation(api.characters.setStatus);
  const name = character.sheet.name;
  const dead = character.status === "dead";
  const bring = character.status === "away" && character.benched === true;

  function set(status: "active" | "dead" | "away") {
    void setStatus({ characterId: character._id, status });
  }

  const kill = canEdit && !dead;
  const revive = dead && isGm;
  const away = canEdit && character.status === "active";
  if (!kill && !revive && !away && !bring) return null;

  return (
    <View style={styles.row}>
      {kill ? (
        <Button accessibilityLabel={`Kill ${name}`} disabled={!writes} onPress={() => set("dead")} variant="danger">
          Kill
        </Button>
      ) : null}
      {revive ? (
        <Button accessibilityLabel={`Revive ${name}`} disabled={!writes} onPress={() => set("active")} variant="outline">
          Revive
        </Button>
      ) : null}
      {away ? (
        <Button accessibilityLabel={`Send ${name} away`} disabled={!writes} onPress={() => set("away")} variant="outline">
          Send away
        </Button>
      ) : null}
      {bring ? (
        <Button accessibilityLabel={`Bring ${name} back`} disabled={!writes} onPress={() => set("active")} variant="outline">
          Bring back
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space[3],
  },
  heading: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 24,
    fontWeight: textType.displayBold.fontWeight,
  },
  empty: {
    color: colors.mutedText,
    fontFamily: textType.serif.fontFamily,
    fontSize: 16,
    fontStyle: textType.serif.fontStyle,
    fontWeight: textType.serif.fontWeight,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[2],
    padding: space[4],
  },
  name: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 20,
    fontWeight: textType.displayBold.fontWeight,
  },
  meta: {
    color: colors.mutedText,
    fontFamily: textType.sans.fontFamily,
    fontSize: 14,
    fontWeight: textType.sans.fontWeight,
  },
  fallen: {
    color: colors.danger,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 14,
    fontWeight: textType.displayBold.fontWeight,
    letterSpacing: 1.2,
  },
  tracks: {
    gap: space[3],
  },
  track: {
    gap: space[2],
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
});
