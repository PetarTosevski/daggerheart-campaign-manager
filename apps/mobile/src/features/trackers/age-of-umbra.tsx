import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { Text, View } from "react-native";

import { MAX_WATCHERS, SETTLEMENT_MAX } from "../../../../../src/lib/frames/trackers/age-of-umbra";
import { api } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { Loading } from "../../ui/loading";
import { Sheet } from "../../ui/sheet";
import type { TrackerCampaign } from "./campaign";
import { CheckRow, ErrorText, Field, Notice, TrackerButton, TrackerCard } from "./card";
import { useIntent } from "./intent";

type UmbraView = FunctionReturnType<typeof api.trackers.ageOfUmbra.get>;
type LurkingResult = FunctionReturnType<typeof api.trackers.ageOfUmbra.rollLurkingDarkness>;
type Pyre = UmbraView["pyres"][number];
type LurkingLog = NonNullable<UmbraView["gm"]>["log"][number];

const OUTCOME_LABEL: Record<LurkingLog["outcome"], string> = {
  conflict: "An adversary initiates conflict",
  fear2: "+2 Fear",
  fear1: "+1 Fear",
  none: "No effect",
  hope: "Each PC gains a Hope",
};

/** The Age of Umbra (Core pp.288-289): Sacred Pyres, Blessed Branches and the Lurking Darkness. */
export function AgeOfUmbraTracker({ campaign }: { campaign: TrackerCampaign }) {
  const view = useQuery(api.trackers.ageOfUmbra.get, { campaignId: campaign._id });
  if (view === undefined) return <Loading label="Loading the frame tracker…" />;
  if (campaign.role !== "gm") return <PyresBody campaignId={campaign._id} edit={null} view={view} />;
  return <GmUmbra campaign={campaign} view={view} />;
}

function GmUmbra({ campaign, view }: { campaign: TrackerCampaign; view: UmbraView }) {
  const addPyre = useIntent(api.trackers.ageOfUmbra.addPyre);
  const setLit = useIntent(api.trackers.ageOfUmbra.setLit);
  const branches = useIntent(api.trackers.ageOfUmbra.adjustBranches);
  const atPyre = useIntent(api.trackers.ageOfUmbra.setAtPyre);
  const error = addPyre.error ?? setLit.error ?? branches.error ?? atPyre.error;
  return (
    <View style={{ gap: 16 }}>
      <PyresBody
        campaignId={campaign._id}
        edit={{
          error,
          pending: addPyre.pending || setLit.pending || branches.pending || atPyre.pending,
          addPyre: (settlement) => addPyre.fire({ campaignId: campaign._id, settlement }),
          setLit: (pyreId, lit) => setLit.fire({ campaignId: campaign._id, pyreId, lit }),
          branches: (delta) => branches.fire({ campaignId: campaign._id, delta }),
          atPyre: (next) => atPyre.fire({ campaignId: campaign._id, atPyre: next }),
        }}
        view={view}
      />
      {view.gm ? <LurkingCard campaignId={campaign._id} log={view.gm.log} view={view} /> : null}
    </View>
  );
}

type PyreEdit = {
  error: string | null;
  pending: boolean;
  addPyre: (settlement: string) => Promise<unknown>;
  setLit: (pyreId: string, lit: boolean) => Promise<unknown>;
  branches: (delta: 1 | -1) => Promise<unknown>;
  atPyre: (next: boolean) => Promise<unknown>;
};

function PyresBody({
  campaignId,
  view,
  edit,
}: {
  campaignId: TrackerCampaign["_id"];
  view: UmbraView;
  edit: PyreEdit | null;
}) {
  const [name, setName] = useState("");
  const [igniting, setIgniting] = useState(false);
  const [reminder, setReminder] = useState<string | null>(null);
  const readOnly = edit === null;

  return (
    <TrackerCard subtitle="Where a Sacred Pyre burns, the Enduring find safety." title="Sacred Pyres">
      <CheckRow
        checked={view.atPyre}
        disabled={readOnly || edit?.pending === true}
        label="The party is at a Sacred Pyre"
        onPress={readOnly ? undefined : () => void edit.atPyre(!view.atPyre)}
      />
      {view.pyres.length ? (
        <View accessibilityLabel="Sacred Pyres" style={{ gap: 8 }}>
          {view.pyres.map((pyre) => (
            <PyreRow
              key={pyre.id}
              campaignId={campaignId}
              onToggle={readOnly ? undefined : () => void edit.setLit(pyre.id, !pyre.lit)}
              pyre={pyre}
              readOnly={readOnly}
              toggling={edit?.pending === true}
            />
          ))}
        </View>
      ) : (
        <Text style={{ color: colors.mutedText }}>No Sacred Pyres recorded yet.</Text>
      )}
      {readOnly ? null : (
        <View style={{ gap: 8 }}>
          <Field label="Settlement" maxLength={SETTLEMENT_MAX} onChangeText={setName} value={name} />
          <TrackerButton
            disabled={!name.trim() || edit.pending}
            onPress={() => {
              void edit.addPyre(name).then((result) => {
                if (result) setName("");
              });
            }}
          >
            Add pyre
          </TrackerButton>
        </View>
      )}
      <Text style={{ color: colors.parchment }}>
        Blessed Branches: <Text testID="blessed-branches">{view.blessedBranches}</Text>
      </Text>
      {readOnly ? null : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <TrackerButton
            accessibilityLabel="Remove a Blessed Branch"
            disabled={view.blessedBranches < 1 || edit.pending}
            onPress={() => void edit.branches(-1)}
          >
            −
          </TrackerButton>
          <TrackerButton
            accessibilityLabel="Add a Blessed Branch"
            disabled={edit.pending}
            onPress={() => void edit.branches(1)}
          >
            +
          </TrackerButton>
          <TrackerButton disabled={view.blessedBranches < 1} onPress={() => setIgniting(true)}>
            Ignite a Blessed Branch
          </TrackerButton>
        </View>
      )}
      <Notice>{reminder}</Notice>
      <ErrorText error={edit?.error} />
      {readOnly ? null : (
        <IgniteDialog
          campaignId={campaignId}
          onClose={() => setIgniting(false)}
          onIgnited={setReminder}
          open={igniting}
          pyres={view.pyres}
        />
      )}
    </TrackerCard>
  );
}

function PyreRow({
  pyre,
  readOnly,
  campaignId,
  onToggle,
  toggling,
}: {
  pyre: Pyre;
  readOnly: boolean;
  campaignId: TrackerCampaign["_id"];
  onToggle?: () => void;
  toggling: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const label = `${pyre.settlement}: ${pyre.lit ? "burning" : "extinguished"}`;
  return (
    <View accessibilityLabel={pyre.settlement} style={{ gap: 8 }}>
      <View style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {readOnly ? (
          <Text accessibilityLabel={label} style={{ color: pyre.lit ? colors.hope : colors.mutedText }}>
            {pyre.lit ? "Burning" : "Out"}
          </Text>
        ) : (
          <TrackerButton accessibilityLabel={label} disabled={toggling} onPress={() => onToggle?.()}>
            {pyre.lit ? "Burning" : "Out"}
          </TrackerButton>
        )}
        {editing === null ? (
          <>
            <Text style={{ color: colors.parchment, flexShrink: 1 }}>{pyre.settlement}</Text>
            {readOnly ? null : (
              <GmPyreActions
                campaignId={campaignId}
                editing={editing}
                onEdit={setEditing}
                pyre={pyre}
              />
            )}
          </>
        ) : readOnly ? null : (
          <GmPyreActions campaignId={campaignId} editing={editing} onEdit={setEditing} pyre={pyre} />
        )}
      </View>
    </View>
  );
}

function GmPyreActions({
  campaignId,
  pyre,
  editing,
  onEdit,
}: {
  campaignId: TrackerCampaign["_id"];
  pyre: Pyre;
  editing: string | null;
  onEdit: (value: string | null) => void;
}) {
  const rename = useIntent(api.trackers.ageOfUmbra.renamePyre);
  const remove = useIntent(api.trackers.ageOfUmbra.removePyre);
  if (editing !== null) {
    return (
      <View style={{ flexGrow: 1, gap: 8 }}>
        <Field label="Settlement name" maxLength={SETTLEMENT_MAX} onChangeText={onEdit} value={editing} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TrackerButton
            disabled={!editing.trim() || rename.pending}
            onPress={() => {
              void rename.fire({ campaignId, pyreId: pyre.id, settlement: editing }).then((result) => {
                if (result !== undefined) onEdit(null);
              });
            }}
          >
            Save
          </TrackerButton>
          <TrackerButton onPress={() => onEdit(null)}>Cancel</TrackerButton>
        </View>
        <ErrorText error={rename.error ?? remove.error} />
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <TrackerButton accessibilityLabel={`Rename ${pyre.settlement}`} onPress={() => onEdit(pyre.settlement)}>
        Rename
      </TrackerButton>
      <TrackerButton
        accessibilityLabel={`Remove ${pyre.settlement}`}
        disabled={remove.pending}
        onPress={() => void remove.fire({ campaignId, pyreId: pyre.id })}
      >
        Remove
      </TrackerButton>
      <ErrorText error={rename.error ?? remove.error} />
    </View>
  );
}

function IgniteDialog({
  open,
  onClose,
  campaignId,
  pyres,
  onIgnited,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: TrackerCampaign["_id"];
  pyres: Pyre[];
  onIgnited: (reminder: string) => void;
}) {
  const ignite = useIntent(api.trackers.ageOfUmbra.igniteBranch);
  const unlit = pyres.filter((pyre) => !pyre.lit);
  const [target, setTarget] = useState("new");
  const [name, setName] = useState("");
  const relight = target !== "new" && unlit.some((pyre) => pyre.id === target);
  const ready = relight || (target === "new" && name.trim() !== "");
  if (!open) return null;
  return (
    <Sheet onClose={onClose} open title="Ignite a Blessed Branch">
      <TrackerButton accessibilityLabel="Kindle" onPress={() => setTarget("new")} variant={target === "new" ? "solid" : "outline"}>
        Found a new Sacred Pyre
      </TrackerButton>
      {unlit.map((pyre) => (
        <TrackerButton
          key={pyre.id}
          accessibilityLabel={`Relight ${pyre.settlement}`}
          onPress={() => setTarget(pyre.id)}
          variant={target === pyre.id ? "solid" : "outline"}
        >
          {`Relight ${pyre.settlement}`}
        </TrackerButton>
      ))}
      {target === "new" ? (
        <Field label="New settlement" maxLength={SETTLEMENT_MAX} onChangeText={setName} value={name} />
      ) : null}
      <Text style={{ color: colors.mutedText, fontFamily: type.sans.fontFamily }}>
        When ignited, all Enduring present gain 3 Hope.
      </Text>
      <ErrorText error={ignite.error} />
      <TrackerButton
        disabled={!ready || ignite.pending}
        onPress={() => {
          void ignite
            .fire(relight ? { campaignId, pyreId: target } : { campaignId, settlement: name })
            .then((result) => {
              if (result && typeof result === "object" && "reminder" in result && typeof result.reminder === "string") {
                onIgnited(result.reminder);
                setName("");
                setTarget("new");
                onClose();
              }
            });
        }}
      >
        Ignite
      </TrackerButton>
    </Sheet>
  );
}

function LurkingCard({
  campaignId,
  view,
  log,
}: {
  campaignId: TrackerCampaign["_id"];
  view: UmbraView;
  log: LurkingLog[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <TrackerCard
      actions={
        <TrackerButton disabled={view.atPyre} onPress={() => setOpen(true)}>
          Roll Lurking Darkness
        </TrackerButton>
      }
      gmOnly
      subtitle="Roll after a short or long rest away from a Sacred Pyre."
      title="Lurking Darkness"
    >
      {view.atPyre ? (
        <Text style={{ color: colors.mutedText }}>The party rests at a Sacred Pyre: no roll.</Text>
      ) : null}
      {log.length ? (
        <View accessibilityLabel="Last Lurking Darkness rolls" style={{ gap: 4 }}>
          {log.map((entry) => (
            <Text key={entry.at} style={{ color: colors.body }}>
              {entry.result}
              {entry.watchRoll !== null && entry.result !== entry.gmRoll
                ? ` (watch replaced GM ${entry.gmRoll})`
                : ""}
              : {OUTCOME_LABEL[entry.outcome]}
            </Text>
          ))}
        </View>
      ) : null}
      <LurkingDialog campaignId={campaignId} onClose={() => setOpen(false)} open={open} />
    </TrackerCard>
  );
}

function LurkingDialog({
  open,
  onClose,
  campaignId,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: TrackerCampaign["_id"];
}) {
  const roll = useIntent(api.trackers.ageOfUmbra.rollLurkingDarkness);
  const [watchers, setWatchers] = useState<string[]>([]);
  const [result, setResult] = useState<LurkingResult | null>(null);
  const values = watchers.map(Number);
  const valid = values.every((n) => Number.isInteger(n) && n >= 1 && n <= 12) && watchers.every((w) => w.trim() !== "");

  function close() {
    setResult(null);
    setWatchers([]);
    roll.clearError();
    onClose();
  }

  if (!open) return null;
  return (
    <Sheet onClose={close} open title="Lurking Darkness">
      {result ? (
        <View accessibilityLiveRegion="polite">
          <Text testID="lurking-result" style={{ color: colors.parchment, fontFamily: type.displayBlack.fontFamily, fontSize: 40 }}>
            {result.result}
          </Text>
          <Text style={{ color: colors.mutedText }}>
            GM rolled {result.gmRoll}
            {result.watchRoll !== null
              ? result.result !== result.gmRoll
                ? `; Keep Watch replaced it with ${result.watchRoll}.`
                : `; the best watch roll (${result.watchRoll}) did not beat it.`
              : "."}
          </Text>
          <Text style={{ color: colors.parchment }}>{result.text}</Text>
          {result.fear ? (
            <Text style={{ color: colors.fear }}>
              Fear is now {result.fear.newValue}
              {result.fear.lost ? ` (${result.fear.lost} lost at the cap)` : ""}.
            </Text>
          ) : null}
          <TrackerButton onPress={close}>Done</TrackerButton>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.mutedText }}>
            Keep Watch: each watcher rolls their Hope Die. The party can replace your roll with the highest.
          </Text>
          {watchers.map((watcher, index) => (
            <View key={index} style={{ gap: 8 }}>
              <Field
                label={`Watcher ${index + 1} Hope Die`}
                onChangeText={(value) => setWatchers(watchers.map((item, itemIndex) => (itemIndex === index ? value : item)))}
                value={watcher}
              />
              <TrackerButton
                accessibilityLabel={`Remove watcher ${index + 1}`}
                onPress={() => setWatchers(watchers.filter((_, itemIndex) => itemIndex !== index))}
              >
                Remove
              </TrackerButton>
            </View>
          ))}
          <TrackerButton disabled={watchers.length >= MAX_WATCHERS} onPress={() => setWatchers([...watchers, ""])}>
            + Add watcher
          </TrackerButton>
          <ErrorText error={roll.error} />
          <TrackerButton
            disabled={!valid || roll.pending}
            onPress={() => {
              void roll.fire({ campaignId, watchers: values }).then((next) => {
                if (next) setResult(next);
              });
            }}
          >
            Roll d12
          </TrackerButton>
        </View>
      )}
    </Sheet>
  );
}
