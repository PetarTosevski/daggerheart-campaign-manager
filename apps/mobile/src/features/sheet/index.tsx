import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useMutation, useQuery } from "convex/react";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { FRAME_OF } from "../../../../../src/lib/frames/extras/common";
import { api } from "../../convex";
import type { Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Empty } from "../../ui/empty";
import { Loading } from "../../ui/loading";
import { className, heritageLine, subclassName } from "./catalog";
import { CardsSection } from "./cards";
import type { SheetSlotProps } from "./contract";
import { DeathSlot } from "./death";
import { DiceSlot } from "./dice";
import { DowntimeSection } from "./downtime";
import { EquipmentSection } from "./equipment";
import { FeaturesSlot } from "./features";
import { HeritageSection } from "./heritage";
import { IdentitySection } from "./identity";
import { IncomingSlot } from "./incoming";
import { LevelUpSlot } from "./level-up";
import { QueryBoundary } from "./query-boundary";
import { RestSlot } from "./rest";
import { ResourcesSection } from "./resources";
import { StatusSection } from "./status";
import { StorySection } from "./story";
import { readCharacter, readOpenRest, type Resource, type SheetCharacter, type SheetData } from "./types";

const PAGES = [
  { id: "sheet", label: "Character Sheet" },
  { id: "story", label: "Story & Advancement" },
  { id: "domains", label: "Domains" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

export function CharacterSheet({
  characterId,
  onClose,
}: {
  characterId: string;
  onClose?: () => void;
}) {
  return (
    <QueryBoundary>
      <CharacterBody characterId={characterId} onClose={onClose} />
    </QueryBoundary>
  );
}

function CharacterBody({ characterId, onClose }: { characterId: string; onClose?: () => void }) {
  const campaign = useCampaign();
  const raw = useQuery(api.characters.get, { characterId });
  if (raw === undefined) return <Loading label="Loading character" />;
  if (raw === null) {
    return (
      <View style={styles.stack}>
        <Empty message="It may have been deleted, or it belongs to another campaign." title="Character not found" />
        {onClose ? (
          <Button onPress={onClose} variant="outline">
            Back to the party
          </Button>
        ) : null}
      </View>
    );
  }
  const character = readCharacter(raw);
  if (!character) {
    return <Empty message="This character sheet could not be read." title="Character" />;
  }
  return <LoadedSheet campaignId={campaign._id} character={character} frameId={campaign.frameId} hopeAndFear={campaign.options.hopeAndFear === true} isGm={campaign.role === "gm"} onClose={onClose} />;
}

function LoadedSheet({
  campaignId,
  character,
  frameId,
  hopeAndFear,
  isGm,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  character: SheetCharacter;
  frameId: string;
  hopeAndFear: boolean;
  isGm: boolean;
  onClose?: () => void;
}) {
  const motherboard = frameId === FRAME_OF.motherboard && character.corrupt !== true;
  const extras = useQuery(api.characterExtras.get, motherboard ? { characterId: character._id } : "skip");
  const rest = useQuery(api.rests.current, character.canEdit ? { campaignId } : "skip");
  const [page, setPage] = useState<PageId>("sheet");
  const [error, setError] = useState<string | null>(null);
  const adjustResource = useMutation(api.characters.adjustResource);
  const updateSheet = useMutation(api.characters.updateSheet);
  const moveCard = useMutation(api.characters.moveCard);
  const takeCard = useMutation(api.characters.takeCard);
  const adjustGold = useMutation(api.characters.adjustGold);
  const setChest = useMutation(api.characters.setGoldChest);
  const addItem = useMutation(api.characters.addInventory);
  const removeItem = useMutation(api.characters.removeInventory);
  const addExperience = useMutation(api.characters.addExperience);
  const setExperience = useMutation(api.characters.setExperience);
  const removeExperience = useMutation(api.characters.removeExperience);
  const setStatus = useMutation(api.characters.setStatus);
  const sheet = character.sheet;
  const signature = `${sheet.hp}|${sheet.stress}|${sheet.hope}|${sheet.armorMarked}|${sheet.scars}`;
  const [tracked, setTracked] = useState(signature);
  const [pending, setPending] = useState<Partial<Record<Resource, number>>>({});
  if (tracked !== signature) {
    setTracked(signature);
    setPending({});
  }

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const canEdit = character.canEdit && character.corrupt !== true;
  const slot: SheetSlotProps = { campaignId, isGm, hopeAndFear, character, canEdit };
  const openRest = canEdit ? readOpenRest(rest, character._id) : null;
  const augments = installedAugments(extras);

  function shown(resource: Resource): number {
    const server = resource === "armor" ? sheet.armorMarked : sheet[resource];
    return server + (pending[resource] ?? 0);
  }

  function onStep(resource: Resource, delta: number) {
    setPending((current) => ({ ...current, [resource]: (current[resource] ?? 0) + delta }));
    void run(async () => {
      try {
        await adjustResource({ characterId: character._id, resource, delta });
      } catch (caught) {
        setPending((current) => ({ ...current, [resource]: (current[resource] ?? 0) - delta }));
        throw caught;
      }
    });
  }

  function onUpdate(patch: Partial<Pick<SheetData, "name" | "pronouns" | "description" | "notes" | "background" | "connections" | "traits">>) {
    void run(() => updateSheet({ characterId: character._id, patch }));
  }

  return (
    <ScrollView contentContainerStyle={styles.stack}>
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text accessibilityRole="header" style={styles.name}>
            {sheet.name}
          </Text>
          <Text style={styles.sub}>
            {className(sheet.classId)} · {subclassName(sheet.subclassId)} · Level {sheet.level}
          </Text>
          <Text style={styles.sub}>{heritageLine(sheet)}</Text>
        </View>
        {onClose ? (
          <Pressable accessibilityLabel="Close character sheet" accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeLabel}>Close</Text>
          </Pressable>
        ) : null}
      </View>
      <LevelUpSlot {...slot} />
      <DeathSlot {...slot} />
      <View accessibilityLabel="Sheet pages" style={styles.tabs}>
        {PAGES.map((item) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: page === item.id }}
            key={item.id}
            onPress={() => setPage(item.id)}
            style={page === item.id ? styles.tabOn : styles.tab}
          >
            <Text style={page === item.id ? styles.tabLabelOn : styles.tabLabel}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {page === "sheet" ? (
        <View style={styles.stack}>
          <IncomingSlot {...slot} />
          <IdentitySection canEdit={canEdit} character={character} isGm={isGm} onUpdate={onUpdate} />
          <ResourcesSection augments={augments} onStep={onStep} readOnly={!canEdit} sheet={sheet} shown={shown} />
          <DiceSlot {...slot} />
          <EquipmentSection
            canEdit={canEdit}
            hopeAndFear={hopeAndFear}
            onArmor={(armorId) => void run(() => updateSheet({ characterId: character._id, patch: { armorId } }))}
            onWeapon={(slotName, id) =>
              void run(() =>
                updateSheet({
                  characterId: character._id,
                  patch: slotName === "primary" ? { primaryWeaponId: id ?? "" } : { secondaryWeaponId: id },
                }),
              )
            }
            sheet={sheet}
          />
          <FeaturesSlot {...slot} />
          <DowntimeSection picked={openRest} />
          <RestSlot {...slot} />
          <StatusSection
            canEdit={canEdit}
            name={sheet.name}
            onStatus={(status) => void run(() => setStatus({ characterId: character._id, status }))}
            status={character.status}
          />
        </View>
      ) : null}
      {page === "story" ? (
        <StorySection
          canEdit={canEdit}
          onAddExperience={(name) => void run(() => addExperience({ characterId: character._id, name }))}
          onAddItem={(name) => void run(() => addItem({ characterId: character._id, name }))}
          onChest={(chest) => void run(() => setChest({ characterId: character._id, chest }))}
          onExperience={(experienceId, value) => void run(() => setExperience({ characterId: character._id, experienceId, value }))}
          onGold={(coin, delta) => void run(() => adjustGold({ characterId: character._id, coin, delta }))}
          onRemoveExperience={(experienceId) => void run(() => removeExperience({ characterId: character._id, experienceId }))}
          onRemoveItem={(itemId) => void run(() => removeItem({ characterId: character._id, itemId }))}
          onText={onUpdate}
          sheet={sheet}
        />
      ) : null}
      {page === "domains" ? (
        <View style={styles.stack}>
          <CardsSection
            canEdit={canEdit}
            duringRest={openRest !== null}
            hopeAndFear={hopeAndFear}
            onMove={(cardId, to) =>
              void run(() => moveCard({ characterId: character._id, cardId, to, duringRest: openRest !== null && to === "loadout" }))
            }
            onTake={(cardId) => void run(() => takeCard({ characterId: character._id, cardId }))}
            sheet={sheet}
          />
          <HeritageSection sheet={sheet} />
        </View>
      ) : null}
      <Text style={styles.foot}>
        {canEdit ? "All changes save automatically." : "Read only: only the player and the GM can change this sheet."}
      </Text>
    </ScrollView>
  );
}

function installedAugments(value: unknown): string[] {
  if (typeof value !== "object" || value === null || !("motherboard" in value)) return [];
  const board = value.motherboard;
  if (typeof board !== "object" || board === null || !("installed" in board)) return [];
  const installed = board.installed;
  return Array.isArray(installed) ? installed.filter((item): item is string => typeof item === "string") : [];
}

const styles = StyleSheet.create({
  stack: {
    gap: space[4],
    paddingBottom: space[8],
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space[3],
    justifyContent: "space-between",
  },
  titles: {
    flex: 1,
    gap: space[1],
  },
  name: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  sub: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  close: {
    alignItems: "center",
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space[3],
  },
  closeLabel: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  tabs: {
    gap: space[2],
  },
  tab: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[3],
  },
  tabOn: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: space[3],
  },
  tabLabel: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  tabLabelOn: {
    color: colors.hope,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 15,
    fontWeight: type.sansSemibold.fontWeight,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  foot: {
    color: colors.subtle,
    fontFamily: type.serifItalic.fontFamily,
    fontSize: 16,
    fontStyle: type.serifItalic.fontStyle,
  },
});
