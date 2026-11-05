import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { canAdvanceCountdown, canCancelCountdown, canReverseCountdown } from "../../../../../src/lib/domain/countdowns";
import {
  MAJOR_STEPS,
  MAX_RELATIONSHIP,
  MINOR_STEPS,
  MIN_RELATIONSHIP,
  NATION_IDS,
  NATION_NAMES,
  OBJECTIVE_KIND_LABEL,
  SUGGESTED_OBJECTIVES,
  defaultPicks,
  objectiveLimitError,
  pairKey,
  planWeekAdvance,
  type NationId,
  type ObjectiveKind,
  type WeekPick,
} from "../../../../../src/lib/frames/trackers/five-banners";
import { api, type Id } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";
import { Loading } from "../../ui/loading";
import { Sheet } from "../../ui/sheet";
import type { TrackerCampaign } from "./campaign";
import { ErrorText, Field, TrackerButton, TrackerCard } from "./card";
import { useIntent } from "./intent";

const fb = api.trackers.fiveBanners;
type BannerView = NonNullable<FunctionReturnType<typeof fb.state>>;
type Nation = BannerView["nations"][number];
type Objective = Nation["objectives"][number];
type Relationship = BannerView["relationships"][number];
type WeekResult = FunctionReturnType<typeof fb.advanceWeek>;

/** Five Banners Burning (Core Book pp.268-269): faction relationships, nation sheets and objective countdowns. */
export function FiveBannersTracker({ campaign }: { campaign: TrackerCampaign }) {
  const view = useQuery(fb.state, { campaignId: campaign._id });
  const [advancing, setAdvancing] = useState(false);
  const [lastWeek, setLastWeek] = useState<WeekResult | null>(null);
  if (view === undefined) return <Loading label="Loading the Five Banners…" />;
  if (view === null) return null;
  const gm = view.role === "gm" && campaign.role === "gm";
  const nations = gm ? view.nations : view.nations.filter((nation) => nation.sheet !== null || nation.objectives.length > 0);
  const nothingRevealed = !gm && nations.length === 0 && view.relationships.length === 0;
  const weekLine = lastWeek
    ? [
        `Week ${lastWeek.week} begins.`,
        ...lastWeek.completed.map((item) => `${NATION_NAMES[item.nation]} completed “${item.name}”: pick a new objective.`),
        lastWeek.warning ?? "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  return (
    <TrackerCard
      actions={
        gm ? (
          <TrackerButton onPress={() => setAdvancing(true)}>Advance week</TrackerButton>
        ) : null
      }
      subtitle={`Week ${view.week} · Faction relationships & objective countdowns`}
      title="Five Banners"
    >
      {weekLine ? (
        <Text accessibilityLiveRegion="polite" testID="week-result">
          {weekLine}
        </Text>
      ) : null}
      {nothingRevealed ? (
        <Text style={styles.meta}>Your GM hasn’t revealed any relationships or objectives yet.</Text>
      ) : (
        <View style={styles.stack}>
          {gm || view.relationships.length ? (
            <RelationshipMatrix campaignId={campaign._id} gm={gm} view={view} />
          ) : null}
          {nations.map((nation) => (
            <NationCard key={nation.id} campaignId={campaign._id} gm={gm} nation={nation} />
          ))}
        </View>
      )}
      {gm && advancing ? (
        <AdvanceWeekDialog
          campaignId={campaign._id}
          onClose={() => setAdvancing(false)}
          onDone={(result) => {
            setLastWeek(result);
            setAdvancing(false);
          }}
          view={view}
        />
      ) : null}
    </TrackerCard>
  );
}

function RelationshipMatrix({ view, campaignId, gm }: { view: BannerView; campaignId: TrackerCampaign["_id"]; gm: boolean }) {
  const byPair = new Map(view.relationships.map((relationship) => [pairKey(relationship.a, relationship.b), relationship]));
  const [selected, setSelected] = useState<[NationId, NationId] | null>(null);
  const current = selected ? byPair.get(pairKey(...selected)) : undefined;
  return (
    <View style={styles.stack}>
      <Text accessibilityRole="header" style={styles.heading}>
        Relationships
      </Text>
      <ScrollView horizontal accessibilityLabel="Relationship ratings between the nations, from Nemeses (−3) to Close Allies (+3)">
        <View>
          <View style={styles.matrixRow}>
            <View style={styles.matrixLabel} />
            {NATION_IDS.map((nation) => (
              <Text key={nation} style={styles.matrixHead}>
                {NATION_NAMES[nation]}
              </Text>
            ))}
          </View>
          {NATION_IDS.map((row) => (
            <View key={row} style={styles.matrixRow}>
              <Text style={styles.matrixHead}>{NATION_NAMES[row]}</Text>
              {NATION_IDS.map((col) => {
                if (row === col) return <View key={col} style={styles.matrixEmpty} />;
                const relationship = byPair.get(pairKey(row, col));
                const name = `${NATION_NAMES[row]} and ${NATION_NAMES[col]}`;
                if (!relationship) {
                  return (
                    <View key={col} accessibilityLabel={`${name}: unknown`} style={styles.matrixUnknown}>
                      <Text style={styles.meta}>?</Text>
                    </View>
                  );
                }
                const label = `${name}: ${relationship.label} (${relationship.rating})${gm && relationship.revealed ? ", shown to players" : ""}`;
                const selectedCell = selected !== null && pairKey(...selected) === pairKey(row, col);
                if (!gm) {
                  return (
                    <View key={col} accessibilityLabel={label} style={styles.matrixCell}>
                      <Text style={styles.rating}>{relationship.rating}</Text>
                      <Text style={styles.tiny}>{relationship.label}</Text>
                    </View>
                  );
                }
                return (
                  <Pressable
                    key={col}
                    accessibilityLabel={label}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedCell }}
                    onPress={() => setSelected([row, col])}
                    style={[styles.matrixCell, selectedCell ? styles.matrixSelected : null]}
                  >
                    <Text style={styles.rating}>{relationship.rating}</Text>
                    <Text style={styles.tiny}>{relationship.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {gm && selected && current ? <RelationshipEditor campaignId={campaignId} relationship={current} /> : null}
      {gm && !(selected && current) ? (
        <Text style={styles.meta}>Pick a cell to change a relationship or reveal it to players.</Text>
      ) : null}
    </View>
  );
}

function RelationshipEditor({
  campaignId,
  relationship,
}: {
  campaignId: TrackerCampaign["_id"];
  relationship: Relationship;
}) {
  const set = useIntent(fb.setRelationship);
  const name = `${NATION_NAMES[relationship.a]}–${NATION_NAMES[relationship.b]}`;
  return (
    <View accessibilityLabel={`${name} relationship`} style={styles.block}>
      <Text style={styles.heading}>{name}</Text>
      <Text testID="relationship-value">
        {relationship.label} ({relationship.rating})
      </Text>
      <View style={styles.row}>
        <TrackerButton
          accessibilityLabel={`Worsen ${name} relationship`}
          disabled={set.pending || relationship.value <= MIN_RELATIONSHIP}
          onPress={() => void set.fire({ campaignId, a: relationship.a, b: relationship.b, value: relationship.value - 1 })}
        >
          −
        </TrackerButton>
        <TrackerButton
          accessibilityLabel={`Improve ${name} relationship`}
          disabled={set.pending || relationship.value >= MAX_RELATIONSHIP}
          onPress={() => void set.fire({ campaignId, a: relationship.a, b: relationship.b, value: relationship.value + 1 })}
        >
          +
        </TrackerButton>
        <RevealToggle
          campaignId={campaignId}
          label={`${name} relationship`}
          revealed={relationship.revealed}
          target={{ type: "relationship", a: relationship.a, b: relationship.b }}
        />
      </View>
      <ErrorText error={set.error} />
    </View>
  );
}

function RevealToggle({
  campaignId,
  label,
  revealed,
  target,
}: {
  campaignId: TrackerCampaign["_id"];
  label: string;
  revealed: boolean;
  target:
    | { type: "relationship"; a: NationId; b: NationId }
    | { type: "sheet"; nation: NationId }
    | { type: "objective"; countdownId: Id<"countdowns"> };
}) {
  const toggle = useIntent(fb.toggleReveal);
  return (
    <View>
      <TrackerButton
        accessibilityLabel={`Reveal ${label} to players`}
        disabled={toggle.pending}
        onPress={() => void toggle.fire({ campaignId, target, revealed: !revealed })}
        variant={revealed ? "solid" : "outline"}
      >
        {revealed ? "Shown" : "Hidden"}
      </TrackerButton>
      <ErrorText error={toggle.error} />
    </View>
  );
}

function NationCard({
  nation,
  campaignId,
  gm,
}: {
  nation: Nation;
  campaignId: TrackerCampaign["_id"];
  gm: boolean;
}) {
  const [dialog, setDialog] = useState<"objective" | "sheet" | null>(null);
  const objectivesFull =
    objectiveLimitError(nation.objectives, "objective-major") !== null &&
    objectiveLimitError(nation.objectives, "objective-minor") !== null;
  return (
    <View accessibilityLabel={nation.name} style={styles.block}>
      <Text accessibilityRole="header" style={styles.heading}>
        {nation.name}
      </Text>
      {gm ? (
        <RevealToggle
          campaignId={campaignId}
          label={`${nation.name} sheet`}
          revealed={nation.sheetRevealed}
          target={{ type: "sheet", nation: nation.id }}
        />
      ) : null}
      {nation.sheet ? (
        <View>
          <Text style={styles.meta}>Assets</Text>
          <Text style={styles.body}>{nation.sheet.assets.length ? nation.sheet.assets.join(" · ") : "None"}</Text>
          <Text style={styles.meta}>Problems</Text>
          <Text style={styles.body}>{nation.sheet.problems.length ? nation.sheet.problems.join(" · ") : "None"}</Text>
        </View>
      ) : null}
      {gm ? (
        <TrackerButton accessibilityLabel={`Edit ${nation.name} assets and problems`} onPress={() => setDialog("sheet")}>
          Edit sheet
        </TrackerButton>
      ) : null}
      <Text style={styles.meta}>Objectives</Text>
      {nation.objectives.length ? (
        nation.objectives.map((objective) => (
          <ObjectiveRow key={objective._id} campaignId={campaignId} gm={gm} objective={objective} />
        ))
      ) : (
        <Text style={styles.meta}>{gm ? "No objective countdowns yet." : "None revealed."}</Text>
      )}
      {gm ? (
        <TrackerButton
          accessibilityLabel={`New ${nation.name} objective`}
          disabled={objectivesFull}
          onPress={() => setDialog("objective")}
        >
          + Objective
        </TrackerButton>
      ) : null}
      {gm && dialog === "objective" ? (
        <NewObjectiveDialog campaignId={campaignId} nation={nation} onClose={() => setDialog(null)} />
      ) : null}
      {gm && dialog === "sheet" ? (
        <SheetDialog campaignId={campaignId} nation={nation} onClose={() => setDialog(null)} />
      ) : null}
    </View>
  );
}

function ObjectiveRow({
  objective,
  campaignId,
  gm,
}: {
  objective: Objective;
  campaignId: TrackerCampaign["_id"];
  gm: boolean;
}) {
  const done = objective.status === "completed";
  return (
    <View accessibilityLabel={objective.name} style={styles.block}>
      <Text style={styles.body}>{objective.name}</Text>
      <Text style={styles.meta}>
        {OBJECTIVE_KIND_LABEL[objective.kind]}
        {objective.status === "paused" ? " · Paused" : ""}
      </Text>
      {gm && objective.notes ? <Text style={styles.meta}>{objective.notes}</Text> : null}
      <Text testID="objective-value">
        {objective.currentValue}/{objective.startingValue}
      </Text>
      {done ? (
        <Text>Objective complete. Pick a new objective from the fiction and start a new countdown.</Text>
      ) : null}
      {gm ? <ObjectiveActions campaignId={campaignId} objective={objective} /> : null}
    </View>
  );
}

function ObjectiveActions({ objective, campaignId }: { objective: Objective; campaignId: TrackerCampaign["_id"] }) {
  const operate = useIntent(fb.operateObjective);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { _id: countdownId, name, currentValue: value, startingValue: start, status } = objective;
  const done = status === "completed";
  const act = (action: "advance" | "reverse" | "pause" | "resume" | "cancel" | "dismiss") =>
    void operate.fire({ countdownId, action });
  return (
    <View style={styles.stack}>
      <View style={styles.row}>
        {done ? (
          <TrackerButton disabled={operate.pending} onPress={() => act("dismiss")}>
            Dismiss
          </TrackerButton>
        ) : (
          <>
            <TrackerButton
              accessibilityLabel={`Tick ${name} down one`}
              disabled={operate.pending || !canAdvanceCountdown(status, value)}
              onPress={() => act("advance")}
              variant="solid"
            >
              Tick −1
            </TrackerButton>
            <TrackerButton
              accessibilityLabel={`Set ${name} back one`}
              disabled={operate.pending || !canReverseCountdown(status, value, start)}
              onPress={() => act("reverse")}
            >
              +1
            </TrackerButton>
            <TrackerButton disabled={operate.pending} onPress={() => act(status === "paused" ? "resume" : "pause")}>
              {status === "paused" ? "Resume" : "Pause"}
            </TrackerButton>
          </>
        )}
        {done ? (
          <TrackerButton accessibilityLabel={`Set ${name} back one`} disabled={operate.pending} onPress={() => act("reverse")}>
            Reopen
          </TrackerButton>
        ) : null}
        <RevealToggle
          campaignId={campaignId}
          label={name}
          revealed={objective.revealed}
          target={{ type: "objective", countdownId }}
        />
      </View>
      {canCancelCountdown(status) ? (
        confirmCancel ? (
          <View accessibilityLabel={`Cancel ${name}`} style={styles.block}>
            <Text style={styles.body}>Abandon this objective?</Text>
            <TrackerButton onPress={() => setConfirmCancel(false)}>Keep it</TrackerButton>
            <TrackerButton disabled={operate.pending} onPress={() => act("cancel")} variant="dangerSolid">
              Abandon
            </TrackerButton>
          </View>
        ) : (
          <TrackerButton onPress={() => setConfirmCancel(true)}>Abandon objective…</TrackerButton>
        )
      ) : null}
      <ErrorText error={operate.error} />
    </View>
  );
}

function NewObjectiveDialog({
  campaignId,
  nation,
  onClose,
}: {
  campaignId: TrackerCampaign["_id"];
  nation: Nation;
  onClose: () => void;
}) {
  const create = useIntent(fb.createObjective);
  const limit = (kind: ObjectiveKind) => objectiveLimitError(nation.objectives, kind);
  const initialKind: ObjectiveKind = limit("objective-major") ? "objective-minor" : "objective-major";
  const [kind, setKind] = useState<ObjectiveKind>(initialKind);
  const [steps, setSteps] = useState<number>(initialKind === "objective-major" ? MAJOR_STEPS : MINOR_STEPS[0]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const suggestions = SUGGESTED_OBJECTIVES[nation.id][kind === "objective-major" ? "major" : "minor"];
  return (
    <Sheet
      onClose={() => {
        create.clearError();
        onClose();
      }}
      open
      title={`${nation.name} objective`}
    >
      <View accessibilityLabel="Objective size" accessibilityRole="radiogroup" style={styles.row}>
        <TrackerButton
          disabled={limit("objective-major") !== null}
          onPress={() => {
            setKind("objective-major");
            setSteps(MAJOR_STEPS);
          }}
          variant={kind === "objective-major" ? "solid" : "outline"}
        >
          {`Major (${MAJOR_STEPS} steps)`}
        </TrackerButton>
        <TrackerButton
          disabled={limit("objective-minor") !== null}
          onPress={() => {
            setKind("objective-minor");
            setSteps(MINOR_STEPS[0]);
          }}
          variant={kind === "objective-minor" ? "solid" : "outline"}
        >
          Minor (4–6 steps)
        </TrackerButton>
      </View>
      {kind === "objective-minor" ? (
        <View accessibilityLabel="Steps" accessibilityRole="radiogroup" style={styles.row}>
          {MINOR_STEPS.map((count) => (
            <TrackerButton key={count} onPress={() => setSteps(count)} variant={steps === count ? "solid" : "outline"}>
              {String(count)}
            </TrackerButton>
          ))}
        </View>
      ) : null}
      <Field label="Objective" maxLength={150} onChangeText={setName} placeholder="What is the nation working toward?" value={name} />
      {suggestions.map((suggestion) => (
        <TrackerButton key={suggestion} onPress={() => setName(suggestion)}>
          {suggestion}
        </TrackerButton>
      ))}
      <Field label="GM notes" maxLength={1000} onChangeText={setNotes} placeholder="GM notes (never shown to players)" value={notes} />
      <ErrorText error={create.error} />
      <TrackerButton
        disabled={create.pending || limit(kind) !== null || !name.trim()}
        onPress={() => {
          void create
            .fire({ campaignId, nation: nation.id, kind, steps, name, notes })
            .then((created) => {
              if (created) onClose();
            });
        }}
      >
        {`Start at ${steps}`}
      </TrackerButton>
    </Sheet>
  );
}

function SheetDialog({
  campaignId,
  nation,
  onClose,
}: {
  campaignId: TrackerCampaign["_id"];
  nation: Nation;
  onClose: () => void;
}) {
  const save = useIntent(fb.setNationSheet);
  const [assets, setAssets] = useState(nation.sheet?.assets.join("\n") ?? "");
  const [problems, setProblems] = useState(nation.sheet?.problems.join("\n") ?? "");
  const lines = (value: string) => value.split("\n");
  return (
    <Sheet
      onClose={() => {
        save.clearError();
        onClose();
      }}
      open
      title={`${nation.name} sheet`}
    >
      <Text style={styles.meta}>One per line.</Text>
      <Field label="Assets" multiline onChangeText={setAssets} value={assets} />
      <Field label="Problems" multiline onChangeText={setProblems} value={problems} />
      <ErrorText error={save.error} />
      <TrackerButton
        disabled={save.pending}
        onPress={() => {
          void save
            .fire({ campaignId, nation: nation.id, assets: lines(assets), problems: lines(problems) })
            .then((saved) => {
              if (saved) onClose();
            });
        }}
      >
        Save
      </TrackerButton>
    </Sheet>
  );
}

function AdvanceWeekDialog({
  view,
  campaignId,
  onClose,
  onDone,
}: {
  view: BannerView;
  campaignId: TrackerCampaign["_id"];
  onClose: () => void;
  onDone: (result: WeekResult) => void;
}) {
  const advance = useIntent(fb.advanceWeek);
  const objectives = view.nations.flatMap((nation) =>
    nation.objectives.map((objective) => ({
      id: objective._id as string,
      nation: nation.id,
      name: objective.name,
      status: objective.status,
      currentValue: objective.currentValue,
    })),
  );
  const [picks, setPicks] = useState<WeekPick[]>(() => defaultPicks(objectives));
  const pickFor = (nation: NationId) => picks.find((pick) => pick.nation === nation)?.objectiveId ?? "";
  const choose = (nation: NationId, id: string) =>
    setPicks((prev) => [...prev.filter((pick) => pick.nation !== nation), ...(id ? [{ nation, objectiveId: id }] : [])]);
  let warning: string | null = null;
  try {
    warning = planWeekAdvance(objectives, picks).warning;
  } catch {
    warning = null;
  }
  return (
    <Sheet onClose={onClose} open title={`Advance to week ${view.week + 1}`}>
      <Text style={styles.meta}>Each in-game week, pick one countdown for each nation to tick down.</Text>
      {view.nations.map((nation) => {
        const options = nation.objectives.filter((objective) => objective.status === "active" && objective.currentValue > 0);
        return (
          <View key={nation.id} accessibilityLabel={nation.name}>
            <Text style={styles.heading}>{nation.name}</Text>
            {options.map((objective) => (
              <TrackerButton
                key={objective._id}
                accessibilityLabel={`${nation.name} ${objective.name}`}
                onPress={() => choose(nation.id, objective._id)}
                variant={pickFor(nation.id) === objective._id ? "solid" : "outline"}
              >
                {`${objective.name} ${objective.currentValue} → ${objective.currentValue - 1}`}
              </TrackerButton>
            ))}
            <TrackerButton
              accessibilityLabel={options.length ? `${nation.name} skip this week` : `${nation.name} no running objectives`}
              onPress={() => choose(nation.id, "")}
              variant={pickFor(nation.id) === "" ? "solid" : "outline"}
            >
              {options.length ? "Skip this week" : "No running objectives"}
            </TrackerButton>
          </View>
        );
      })}
      {warning ? <Text accessibilityRole="alert">{warning}</Text> : null}
      <ErrorText error={advance.error} />
      <TrackerButton
        disabled={advance.pending}
        onPress={() => {
          void advance
            .fire({
              campaignId,
              picks: picks.map((pick) => ({ nation: pick.nation, objectiveId: pick.objectiveId as Id<"countdowns"> })),
            })
            .then((result) => {
              if (result) onDone(result);
            });
        }}
      >
        Advance week
      </TrackerButton>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  block: {
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  heading: { color: colors.parchment, fontFamily: type.displayBold.fontFamily, fontSize: 18 },
  meta: { color: colors.mutedText, fontFamily: type.sans.fontFamily, fontSize: 13 },
  body: { color: colors.parchment, fontFamily: type.sans.fontFamily, fontSize: 15 },
  matrixRow: { flexDirection: "row" },
  matrixHead: {
    color: colors.mutedText,
    fontFamily: type.displayMedium.fontFamily,
    fontSize: 11,
    height: hit.minHeight,
    textAlign: "center",
    width: 72,
  },
  matrixLabel: { width: 72 },
  matrixCell: {
    alignItems: "center",
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    height: hit.minHeight,
    justifyContent: "center",
    margin: 2,
    width: 72,
  },
  matrixSelected: { borderColor: colors.brand },
  matrixEmpty: { height: hit.minHeight, margin: 2, width: 72 },
  matrixUnknown: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: radius.md,
    borderStyle: "dashed",
    borderWidth: 1,
    height: hit.minHeight,
    justifyContent: "center",
    margin: 2,
    width: 72,
  },
  rating: { color: colors.parchment, fontFamily: type.displayBold.fontFamily, fontSize: 14 },
  tiny: { color: colors.mutedText, fontSize: 9 },
});
