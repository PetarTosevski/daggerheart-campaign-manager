import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { api, type Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";

import { Chip, ErrorLine, Stepper } from "./controls";
import { useIntent } from "./intent";
import { advStyles } from "./styles";
import type { AddTarget, EncounterList } from "./types";

const MAX_COUNT = 10;
const MAX_MINIONS = 30;
/** Minion group size when no party size is known (open question 4 default). */
const DEFAULT_GROUP = 4;
const NEW = "__new__";

function targetKey(target: AddTarget): string {
  return target.source.kind === "srd" ? `srd:${target.source.adversaryId}` : `custom:${target.source.customId}`;
}

/**
 * "Add to encounter": an encounter (or a new one), how many (a Minion group's size for Minions) and Summoned
 * (costs no Battle Points, CB p.197). With `encounterId` the encounter is fixed (the builder's own add).
 */
export function AddToEncounterSheet({
  campaignId,
  target,
  encounters,
  encounterId,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  target: AddTarget | null;
  encounters: EncounterList | undefined;
  encounterId?: string;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} open={target !== null} title="Add to encounter">
      {target ? (
        <AddToEncounterForm
          campaignId={campaignId}
          encounterId={encounterId}
          encounters={encounters}
          key={targetKey(target)}
          onClose={onClose}
          target={target}
        />
      ) : null}
    </Sheet>
  );
}

export function AddToEncounterForm({
  campaignId,
  target,
  encounters,
  encounterId,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  target: AddTarget;
  encounters: EncounterList | undefined;
  encounterId?: string;
  onClose: () => void;
}) {
  const writes = useWritesEnabled();
  const create = useIntent(api.encounters.create);
  const add = useIntent(api.encounters.addAdversary);
  const [chosen, setChosen] = useState<string | null>(null);
  const [newName, setNewName] = useState("New encounter");
  const [count, setCount] = useState<number | null>(null);
  const [summoned, setSummoned] = useState(false);

  if (encounters === undefined) return <Text style={advStyles.muted}>Loading encounters…</Text>;

  const minion = target.type === "Minion";
  const max = minion ? MAX_MINIONS : MAX_COUNT;
  const destination = encounterId ?? chosen ?? encounters.active[0]?._id ?? NEW;
  const groupSize = encounters.active.find((e) => e._id === destination)?.pcs ?? DEFAULT_GROUP;
  const amount = Math.min(max, count ?? (minion ? groupSize : 1));
  const error = create.error ?? add.error;

  async function submit() {
    let id = destination;
    if (id === NEW) {
      const created = await create.fire({ campaignId, name: newName });
      if (!created) return;
      id = created.encounterId;
    }
    const done = await add.fire({ campaignId, encounterId: id, source: target.source, count: amount, summoned });
    if (done) onClose();
  }

  return (
    <View style={advStyles.section}>
      <Text style={advStyles.body}>
        <Text style={advStyles.statStrong}>{target.name}</Text> · Tier {target.tier} {target.type}
        {target.source.kind === "custom" ? " · Custom" : ""}
      </Text>
      {encounterId === undefined ? (
        <>
          <Text style={advStyles.label}>Encounter</Text>
          <View accessibilityRole="radiogroup" style={advStyles.row}>
            {encounters.active.map((e) => (
              <Chip
                key={e._id}
                label={e.status === "running" ? `${e.name} (running)` : e.name}
                on={destination === e._id}
                onPress={() => setChosen(e._id)}
              />
            ))}
            <Chip label="New encounter…" on={destination === NEW} onPress={() => setChosen(NEW)} />
          </View>
          {destination === NEW ? (
            <TextInput
              accessibilityLabel="New encounter name"
              maxLength={80}
              onChangeText={setNewName}
              style={advStyles.input}
              value={newName}
            />
          ) : null}
        </>
      ) : null}
      <Text style={advStyles.label}>{minion ? "Minions in the group" : "How many"}</Text>
      <Stepper
        downDisabled={amount <= 1}
        label={minion ? "Minions" : "Adversaries"}
        onDown={() => setCount(Math.max(1, amount - 1))}
        onUp={() => setCount(Math.min(max, amount + 1))}
        upDisabled={amount >= max}
        value={String(amount)}
      />
      <Chip label="Summoned (costs no Battle Points)" on={summoned} onPress={() => setSummoned((s) => !s)} role="switch" />
      <ErrorLine message={error} />
      <View style={advStyles.row}>
        <Button onPress={onClose} variant="outline">
          Cancel
        </Button>
        <Button disabled={!writes || create.pending || add.pending} onPress={() => void submit()} variant="solid">
          Add to encounter
        </Button>
      </View>
    </View>
  );
}
