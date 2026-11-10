import { useState, type ReactNode } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { tierForLevel } from "../../../../../../../src/lib/domain/characters";
import type { ImportDraft, Unmatched } from "../../../../../../../src/lib/import/draft";
import { importProblem } from "../../../../../../../src/lib/import/sheet";
import { CLASSES } from "../../../../../../../src/lib/srd/classes";
import { DOMAIN_CARDS } from "../../../../../../../src/lib/srd/domain-cards";
import { ARMOR, WEAPONS } from "../../../../../../../src/lib/srd/equipment";
import { TIERED_ARMOR, TIERED_WEAPONS } from "../../../../../../../src/lib/srd/equipment-tiers";
import { ANCESTRIES, COMMUNITIES } from "../../../../../../../src/lib/srd/heritage";
import { SUBCLASSES } from "../../../../../../../src/lib/srd/subclasses";
import { TRAIT_IDS, type Source } from "../../../../../../../src/lib/srd/types";
import type { Id } from "../../../../convex";
import { colors } from "../../../../theme/colors";
import { type } from "../../../../theme/fonts";
import { Button } from "../../../../ui/button";
import { wizardStyles as s } from "../styles";

export type Owner = { userId: Id<"users">; name: string };

const ALL_WEAPONS = [...WEAPONS, ...TIERED_WEAPONS];
const ALL_ARMOR = [...ARMOR, ...TIERED_ARMOR];

const toInt = (value: string) => (/^-?\d+$/.test(value.trim()) ? Number.parseInt(value, 10) : Number.NaN);

type Props = {
  initial: ImportDraft;
  unreadable: string[];
  unmatched: Unmatched[];
  hopeAndFear: boolean;
  owners: Owner[];
  defaultOwner?: Id<"users">;
  saving: boolean;
  error: string | null;
  onSave: (draft: ImportDraft, ownerId: Id<"users">) => void;
};

/** Editable review of a photo-read draft before `photoImport.create`. */
export function ReviewForm({ initial, unreadable, unmatched, hopeAndFear, owners, defaultOwner, saving, error, onSave }: Props) {
  const [draft, setDraft] = useState<ImportDraft>(initial);
  const [ownerId, setOwnerId] = useState<Id<"users"> | "">(defaultOwner ?? "");
  const sources: Source[] = hopeAndFear ? ["core", "hope-and-fear"] : ["core"];
  const usable = <T extends { source: Source }>(list: readonly T[]) => list.filter((item) => sources.includes(item.source));
  const set = <K extends keyof ImportDraft>(key: K, value: ImportDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const note = (path: string): string | null => {
    const miss = unmatched.find((u) => u.field === path);
    if (miss) return `Read as “${miss.text}”, which matched nothing.`;
    return unreadable.includes(path) ? "Could not be read." : null;
  };

  const tier = tierForLevel(Number.isInteger(draft.level) ? Math.min(10, Math.max(1, draft.level)) : 1);
  const cls = CLASSES.find((c) => c.id === draft.classId);
  const weapons = usable(ALL_WEAPONS).filter((w) => w.tier <= tier && (!w.classId || w.classId === draft.classId));
  const problem = importProblem(draft, hopeAndFear) ?? (ownerId === "" ? "Choose who owns the character." : null);

  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <Field label="Name" note={note("name")}>
        <TextInput accessibilityLabel="Name" onChangeText={(name) => set("name", name)} style={s.input} value={draft.name} />
      </Field>
      <Field label="Level" note={note("level")}>
        <TextInput
          accessibilityLabel="Level"
          keyboardType="number-pad"
          onChangeText={(text) => set("level", toInt(text))}
          style={s.input}
          value={Number.isNaN(draft.level) ? "" : String(draft.level)}
        />
      </Field>
      <PickRow
        label="Class"
        note={note("classId")}
        onPick={(classId) => set("classId", classId)}
        options={usable(CLASSES).map((c) => ({ id: c.id, name: c.name }))}
        value={draft.classId}
      />
      <PickRow
        label="Subclass"
        note={note("subclassId")}
        onPick={(subclassId) => set("subclassId", subclassId)}
        options={usable(SUBCLASSES).filter((sub) => sub.classId === draft.classId).map((sub) => ({ id: sub.id, name: sub.name }))}
        value={draft.subclassId}
      />
      <PickRow
        label="Ancestry"
        note={note("ancestry.id")}
        onPick={(id) => set("ancestry", { kind: "single", id })}
        options={usable(ANCESTRIES).map((a) => ({ id: a.id, name: a.name }))}
        value={draft.ancestry.kind === "single" ? draft.ancestry.id : ""}
      />
      <PickRow
        label="Community"
        note={note("communityId")}
        onPick={(communityId) => set("communityId", communityId)}
        options={usable(COMMUNITIES).map((c) => ({ id: c.id, name: c.name }))}
        value={draft.communityId}
      />
      <Text style={s.label}>Traits</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {TRAIT_IDS.map((trait) => (
          <TextInput
            accessibilityLabel={trait}
            key={trait}
            keyboardType="number-pad"
            onChangeText={(text) => set("traits", { ...draft.traits, [trait]: toInt(text) })}
            placeholder={trait}
            style={[s.input, { minWidth: 100 }]}
            value={String(draft.traits[trait] ?? "")}
          />
        ))}
      </View>
      <PickRow
        label="Primary weapon"
        note={note("primaryWeaponId")}
        onPick={(primaryWeaponId) => set("primaryWeaponId", primaryWeaponId)}
        options={weapons.filter((w) => w.slot === "primary").map((w) => ({ id: w.id, name: w.name }))}
        value={draft.primaryWeaponId}
      />
      <PickRow
        label="Armor"
        note={note("armorId")}
        onPick={(armorId) => set("armorId", armorId)}
        options={usable(ALL_ARMOR).filter((a) => a.tier <= tier).map((a) => ({ id: a.id, name: a.name }))}
        value={draft.armorId ?? ""}
      />
      <Field label="Experiences (one per line)" note={null}>
        <TextInput
          accessibilityLabel="Experiences"
          multiline
          onChangeText={(text) =>
            set(
              "experiences",
              text
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 12)
                .map((name, i) => ({ name, value: i < 2 ? 2 : 1 })),
            )
          }
          style={[s.input, s.textArea]}
          value={draft.experiences.map((e) => e.name).join("\n")}
        />
      </Field>
      <Text style={s.label}>Domain cards</Text>
      <View style={{ gap: 8 }}>
        {usable(DOMAIN_CARDS)
          .filter((c) => cls?.domains.includes(c.domain) && c.level <= draft.level)
          .slice(0, 24)
          .map((card) => {
            const on = draft.domainCards.includes(card.id);
            return (
              <Button
                key={card.id}
                onPress={() =>
                  set(
                    "domainCards",
                    on ? draft.domainCards.filter((id) => id !== card.id) : [...draft.domainCards, card.id].slice(0, 40),
                  )
                }
                variant={on ? "solid" : "outline"}
              >
                {card.name}
              </Button>
            );
          })}
      </View>
      <Text style={s.label}>Character for</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {owners.map((o) => (
          <Button key={o.userId} onPress={() => setOwnerId(o.userId)} variant={ownerId === o.userId ? "solid" : "outline"}>
            {o.name}
          </Button>
        ))}
      </View>
      {problem ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontFamily: type.sans.fontFamily, fontSize: 15 }}>
          {problem}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontFamily: type.sans.fontFamily, fontSize: 15 }}>
          {error}
        </Text>
      ) : null}
      <Button disabled={Boolean(problem) || saving || ownerId === ""} onPress={() => onSave(draft, ownerId as Id<"users">)} variant="primary">
        {saving ? "Saving…" : "Save character"}
      </Button>
    </ScrollView>
  );
}

function Field({ label, note, children }: { label: string; note: string | null; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      {note ? <Text style={s.hint}>{note}</Text> : null}
      {children}
    </View>
  );
}

function PickRow({
  label,
  note,
  value,
  options,
  onPick,
}: {
  label: string;
  note: string | null;
  value: string;
  options: { id: string; name: string }[];
  onPick: (id: string) => void;
}) {
  return (
    <Field label={label} note={note}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => (
          <Button key={o.id} onPress={() => onPick(o.id)} variant={value === o.id ? "solid" : "outline"}>
            {o.name}
          </Button>
        ))}
      </View>
    </Field>
  );
}
