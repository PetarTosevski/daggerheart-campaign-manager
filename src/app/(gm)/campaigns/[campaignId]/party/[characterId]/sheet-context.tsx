"use client";

import { useMutation, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { SlotProps } from "@/components/party/slots";
import { errorMessage } from "@/lib/convex-errors";
import { derivedDefense } from "@/lib/domain/characters/derived";
import { withEffects } from "@/lib/domain/characters/effects";
import { FRAME_OF } from "@/lib/frames/extras/common";
import type { MotherboardState } from "@/lib/frames/extras/motherboard";
import type { SheetPatch } from "@/lib/validation/characters";

import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../../../../../convex/characters";
import { useCampaign } from "../../campaign-shell";

export type Resource = "hp" | "stress" | "hope" | "armor" | "scars";
/** The statuses the sheet sets by hand (`away` comes only from death moves). */
export type CharacterStatus = "active" | "dead" | "retired";

type SheetContextValue = {
  character: CharacterView;
  sheet: CharacterView["sheet"];
  canEdit: boolean;
  hopeAndFear: boolean;
  /** Props for the D5 feature slots mounted on the sheet (src/components/party/slots.ts). */
  slot: SlotProps;
  update: (patch: SheetPatch) => Promise<boolean>;
  adjust: (resource: Resource, delta: number) => Promise<boolean>;
  applyDamage: (damage: number, useArmorSlot: boolean) => Promise<boolean>;
  moveCard: (cardId: string, to: "loadout" | "vault", duringRest: boolean) => Promise<boolean>;
  /** Takes a card from the Domain Deck (loadout while it has room, else vault). */
  takeCard: (cardId: string) => Promise<boolean>;
  /** Adds or spends handfuls or bags (CB 104: a 10th rolls over into the next category). */
  adjustGold: (coin: "handfuls" | "bags", delta: number) => Promise<boolean>;
  setStatus: (status: CharacterStatus) => Promise<boolean>;
  error: string | null;
};

const SheetContext = createContext<SheetContextValue | null>(null);

export function useSheet(): SheetContextValue {
  const value = useContext(SheetContext);
  if (!value) throw new Error("useSheet must be used inside SheetProvider");
  return value;
}

/** Sheet data plus its mutations; any failure lands in one live error message. */
export function SheetProvider({
  character,
  campaignId,
  isGm,
  hopeAndFear,
  children,
}: {
  character: CharacterView;
  campaignId: Id<"campaigns">;
  isGm: boolean;
  hopeAndFear: boolean;
  children: ReactNode;
}) {
  const updateSheet = useMutation(api.characters.updateSheet);
  const adjustResource = useMutation(api.characters.adjustResource);
  const damageMutation = useMutation(api.characters.applyDamage);
  const move = useMutation(api.characters.moveCard);
  const take = useMutation(api.characters.takeCard);
  const gold = useMutation(api.characters.adjustGold);
  const status = useMutation(api.characters.setStatus);
  const [error, setError] = useState<string | null>(null);
  const characterId = character._id;

  const run = useCallback(async (p: () => Promise<unknown>) => {
    setError(null);
    try {
      await p();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }, []);

  const value = useMemo<SheetContextValue>(
    () => ({
      character,
      sheet: character.sheet,
      canEdit: character.canEdit,
      hopeAndFear,
      slot: { campaignId, character, canEdit: character.canEdit, isGm, hopeAndFear },
      update: (patch) => run(() => updateSheet({ characterId, patch })),
      adjust: (resource, delta) => (delta === 0 ? Promise.resolve(true) : run(() => adjustResource({ characterId, resource, delta }))),
      // One key per click, so the Convex client's retries can't mark the damage twice (review L2).
      applyDamage: (damage, useArmorSlot) => run(() => damageMutation({ characterId, damage, useArmorSlot, idempotencyKey: crypto.randomUUID() })),
      moveCard: (cardId, to, duringRest) => run(() => move({ characterId, cardId, to, duringRest })),
      takeCard: (cardId) => run(() => take({ characterId, cardId })),
      adjustGold: (coin, delta) => (delta === 0 ? Promise.resolve(true) : run(() => gold({ characterId, coin, delta }))),
      setStatus: (s) => run(() => status({ characterId, status: s })),
      error,
    }),
    [character, characterId, campaignId, isGm, hopeAndFear, run, updateSheet, adjustResource, damageMutation, move, take, gold, status, error],
  );

  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>;
}

/**
 * The character's Motherboard module in a Motherboard campaign (CB 301-303), or null elsewhere: its installed
 * augments count toward Armor Score and Evasion like the server's `derivedDefense`, and its Ikonis replaces weapons.
 */
export function useMotherboard(): { motherboard: boolean; state: MotherboardState | null } {
  const { character } = useSheet();
  const motherboard = useCampaign().frameId === FRAME_OF.motherboard;
  const extras = useQuery(api.characterExtras.get, motherboard ? { characterId: character._id } : "skip");
  return { motherboard, state: motherboard ? (extras?.motherboard ?? null) : null };
}

/**
 * Evasion and Armor Score as the sheet shows them: with active effects (Rogue's Dodge and the like) and installed
 * augments (Motherboard); the base on the sheet never changes. `effectEvasion` is the part that comes from effects.
 */
export function useDefense() {
  const { sheet } = useSheet();
  const { state } = useMotherboard();
  const augments = state?.installed ?? [];
  const defense = derivedDefense(withEffects(sheet), augments);
  return { defense, effectEvasion: defense.evasion - derivedDefense(sheet, augments).evasion, armorSlots: defense.armorScore };
}
