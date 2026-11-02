import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  COLOSSI_TOTAL,
  EMERGENCE_POWER,
  MAX_POWER,
  SIPHON_SLOTS,
} from "../../../../../src/lib/frames/trackers/colossus";
import { api } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";
import { Loading } from "../../ui/loading";
import type { TrackerCampaign } from "./campaign";
import { ErrorText, Field, Notice, TrackerButton, TrackerCard } from "./card";
import { useIntent } from "./intent";

type ColossusView = FunctionReturnType<typeof api.trackers.colossus.get>;
type GmState = NonNullable<ColossusView["gm"]>;
type Phase = ColossusView["phase"];

/** Colossus of the Drylands (Core pp.318, 327): the hunt, the Siphoning Track and Kudamat's Power. */
export function ColossusTracker({ campaign }: { campaign: TrackerCampaign }) {
  const view = useQuery(api.trackers.colossus.get, { campaignId: campaign._id });
  if (view === undefined) return <Loading label="Loading the frame tracker…" />;
  if (campaign.role !== "gm") return <HuntBody edit={null} view={view} />;
  return <GmColossus campaign={campaign} view={view} />;
}

function GmColossus({ campaign, view }: { campaign: TrackerCampaign; view: ColossusView }) {
  const setPhase = useIntent(api.trackers.colossus.setPhase);
  const defeat = useIntent(api.trackers.colossus.defeatColossus);
  const correct = useIntent(api.trackers.colossus.correct);
  return (
    <View style={{ gap: space[4] }}>
      <HuntBody
        edit={{
          error: setPhase.error ?? defeat.error ?? correct.error,
          pending: setPhase.pending || defeat.pending || correct.pending,
          setPhase: (phase) => setPhase.fire({ campaignId: campaign._id, phase }),
          defeat: () => defeat.fire({ campaignId: campaign._id }),
          correctSlain: (colossiDefeated) => correct.fire({ campaignId: campaign._id, colossiDefeated }),
        }}
        view={view}
      />
      {view.gm ? <KudamatCard campaignId={campaign._id} gm={view.gm} phase={view.phase} /> : null}
    </View>
  );
}

type HuntEdit = {
  error: string | null;
  pending: boolean;
  setPhase: (phase: Phase) => Promise<unknown>;
  defeat: () => Promise<FunctionReturnType<typeof api.trackers.colossus.defeatColossus> | undefined>;
  correctSlain: (colossiDefeated: number) => Promise<unknown>;
};

function HuntBody({ view, edit }: { view: ColossusView; edit: HuntEdit | null }) {
  const [notice, setNotice] = useState<string | null>(null);
  const readOnly = edit === null;
  const allSlain = view.colossiDefeated >= COLOSSI_TOTAL;
  return (
    <TrackerCard
      subtitle={
        view.phase === "hunt" ? "Hunt phase: a colossus stalks the Drylands." : "Interlude: time for smaller, personal tasks."
      }
      title="The Hunt"
    >
      <View accessibilityLabel="Campaign phase" accessibilityRole="radiogroup" style={styles.row}>
        {(["hunt", "interlude"] as const).map((phase) => (
          <TrackerButton
            key={phase}
            accessibilityLabel={phase}
            disabled={readOnly || edit?.pending === true}
            onPress={() => {
              if (edit && view.phase !== phase) void edit.setPhase(phase);
            }}
            variant={view.phase === phase ? "solid" : "outline"}
          >
            {phase === "hunt" ? "Hunt" : "Interlude"}
          </TrackerButton>
        ))}
      </View>
      <Text style={styles.meta}>
        Colossi slain <Text testID="colossi-defeated">{view.colossiDefeated}</Text> / {COLOSSI_TOTAL}
      </Text>
      <View accessibilityLabel="Colossi slain" style={styles.row}>
        {Array.from({ length: COLOSSI_TOTAL }, (_, index) => {
          const slain = index < view.colossiDefeated;
          const next = index + 1 === view.colossiDefeated ? index : index + 1;
          const label = `Correct colossi slain to ${next}`;
          if (readOnly) {
            return <View key={index} accessibilityLabel={label} style={[styles.pip, slain ? styles.pipOn : styles.pipOff]} />;
          }
          return (
            <Pressable
              key={index}
              accessibilityLabel={label}
              accessibilityRole="button"
              disabled={edit.pending}
              onPress={() => void edit.correctSlain(next)}
              style={[styles.pip, slain ? styles.pipOn : styles.pipOff]}
            />
          );
        })}
      </View>
      {readOnly ? null : (
        <TrackerButton
          disabled={allSlain || edit.pending}
          onPress={() => {
            void edit.defeat().then((result) => {
              if (result) {
                setNotice(`${result.notice} Kudamat drew ${result.roll.gained} (rolled ${result.roll.dice.join(", ")}).`);
              }
            });
          }}
        >
          Colossus defeated
        </TrackerButton>
      )}
      <Notice>{notice}</Notice>
      <ErrorText error={edit?.error} />
    </TrackerCard>
  );
}

function KudamatCard({
  campaignId,
  gm,
  phase,
}: {
  campaignId: TrackerCampaign["_id"];
  gm: GmState;
  phase: Phase;
}) {
  const markRest = useIntent(api.trackers.colossus.markRest);
  const correct = useIntent(api.trackers.colossus.correct);
  const [power, setPower] = useState("");
  const powerValue = Number(power);
  const powerValid = power.trim() !== "" && Number.isInteger(powerValue) && powerValue >= 0 && powerValue <= MAX_POWER;
  const width = `${Math.min(100, (gm.kudamatPower / EMERGENCE_POWER) * 100)}%` as const;
  return (
    <TrackerCard gmOnly subtitle="The power siphoned from the soul shards." title="Kudamat">
      {gm.emerged ? (
        <Text accessibilityRole="text" style={styles.emerge}>
          KUDAMAT EMERGES FROM GODFELL MOUNTAIN
        </Text>
      ) : null}
      <Text style={styles.meta}>
        Siphoning Track <Text testID="siphon-marked">{gm.siphonMarked}</Text> / {SIPHON_SLOTS}
      </Text>
      <View accessibilityLabel="Siphoning Track" style={styles.slots}>
        {Array.from({ length: SIPHON_SLOTS }, (_, index) => {
          const marked = index < gm.siphonMarked;
          const target = Math.max(1, index + 1 === gm.siphonMarked ? index : index + 1);
          return (
            <Pressable
              key={index}
              accessibilityLabel={`Slot ${index + 1}${marked ? ", marked" : ""}`}
              accessibilityRole="button"
              accessibilityState={{ selected: marked }}
              disabled={correct.pending || target === gm.siphonMarked}
              onPress={() => void correct.fire({ campaignId, siphonMarked: target })}
              style={[styles.slot, marked ? styles.slotOn : styles.slotOff]}
            />
          );
        })}
      </View>
      <Text testID="siphon-rest-note" style={styles.meta}>
        Party rests mark the track automatically when the GM finishes them. Use these only to correct a rest taken outside the app.
      </Text>
      <View style={styles.row}>
        <TrackerButton
          disabled={phase !== "hunt" || markRest.pending}
          onPress={() => void markRest.fire({ campaignId, kind: "short" })}
        >
          Correction: short rest +1
        </TrackerButton>
        <TrackerButton
          disabled={phase !== "hunt" || markRest.pending}
          onPress={() => void markRest.fire({ campaignId, kind: "long" })}
        >
          Correction: long rest +2
        </TrackerButton>
      </View>
      {phase !== "hunt" ? <Text style={styles.meta}>Rests mark the track only during a hunt.</Text> : null}
      <Text style={styles.meta}>Kudamat’s Power</Text>
      <Text testID="kudamat-power" style={styles.power}>
        {gm.kudamatPower}
      </Text>
      <Text testID="kudamat-major">Major {gm.thresholds.major}</Text>
      <Text testID="kudamat-severe">Severe {gm.thresholds.severe}</Text>
      <View
        accessibilityLabel="Kudamat's Power toward emergence"
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: EMERGENCE_POWER, now: Math.min(gm.kudamatPower, EMERGENCE_POWER) }}
        style={styles.meter}
      >
        <View style={[styles.meterFill, { width }, gm.emerged ? styles.meterDanger : styles.meterCalm]} />
      </View>
      <Field label="Correct Power" onChangeText={setPower} value={power} />
      <TrackerButton
        disabled={!powerValid || correct.pending}
        onPress={() => {
          void correct.fire({ campaignId, kudamatPower: powerValue }).then((result) => {
            if (result !== undefined) setPower("");
          });
        }}
      >
        Set
      </TrackerButton>
      {gm.log.length ? (
        <View accessibilityLabel="Last siphon rolls" style={{ gap: 4 }}>
          <Text style={styles.meta}>Last siphon rolls</Text>
          {gm.log.map((entry) => (
            <Text key={`${entry.at}${entry.dice.join("")}`} style={styles.meta}>
              {entry.reason === "defeat" ? "Colossus slain" : "Track full"}: rolled {entry.dice.join(", ")} → +{entry.gained}{" "}
              (Power {entry.powerAfter})
            </Text>
          ))}
        </View>
      ) : null}
      <ErrorText error={markRest.error ?? correct.error} />
    </TrackerCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  meta: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  pip: {
    borderRadius: 4,
    borderWidth: 1,
    height: hit.minHeight,
    transform: [{ rotate: "45deg" }],
    width: hit.minHeight,
  },
  pipOn: {
    backgroundColor: "#7a5218",
    borderColor: colors.brand,
  },
  pipOff: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
  },
  slots: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
  },
  slot: {
    borderRadius: 5,
    borderWidth: 1,
    height: hit.minHeight,
    width: hit.minHeight,
  },
  slotOn: {
    backgroundColor: "#4b3a7a",
    borderColor: colors.violet,
  },
  slotOff: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
  },
  emerge: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerLine,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.danger,
    fontFamily: type.displayBold.fontFamily,
    letterSpacing: 1,
    padding: space[3],
    textAlign: "center",
  },
  power: {
    color: colors.parchment,
    fontFamily: type.displayBlack.fontFamily,
    fontSize: 44,
    fontWeight: type.displayBlack.fontWeight,
  },
  meter: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    height: 10,
    overflow: "hidden",
  },
  meterFill: {
    height: 10,
  },
  meterCalm: {
    backgroundColor: colors.violet,
  },
  meterDanger: {
    backgroundColor: colors.dangerSolid,
  },
});
