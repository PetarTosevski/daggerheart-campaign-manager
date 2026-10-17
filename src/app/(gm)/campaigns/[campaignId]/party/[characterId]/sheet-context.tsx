"use client";

import { useMutation } from "convex/react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";
import type { CharacterSheet, SheetPatch } from "@/lib/validation/characters";

import { api } from "../../../../../../../convex/_generated/api";
import type { CharacterView } from "../../../../../../../convex/characters";

export type Resource = "hp" | "stress" | "hope" | "armor" | "scars";
export type CharacterStatus = "active" | "dead" | "retired";

type SheetContextValue = {
  character: CharacterView;
  sheet: CharacterSheet;
  canEdit: boolean;
  hopeAndFear: boolean;
  update: (patch: SheetPatch) => Promise<boolean>;
  adjust: (resource: Resource, delta: number) => Promise<boolean>;
  applyDamage: (damage: number, useArmorSlot: boolean) => Promise<boolean>;
  moveCard: (cardId: string, to: "loadout" | "vault", duringRest: boolean) => Promise<boolean>;
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
  hopeAndFear,
  children,
}: {
  character: CharacterView;
  hopeAndFear: boolean;
  children: ReactNode;
}) {
  const updateSheet = useMutation(api.characters.updateSheet);
  const adjustResource = useMutation(api.characters.adjustResource);
  const damageMutation = useMutation(api.characters.applyDamage);
  const move = useMutation(api.characters.moveCard);
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
      update: (patch) => run(() => updateSheet({ characterId, patch })),
      adjust: (resource, delta) => (delta === 0 ? Promise.resolve(true) : run(() => adjustResource({ characterId, resource, delta }))),
      applyDamage: (damage, useArmorSlot) => run(() => damageMutation({ characterId, damage, useArmorSlot })),
      moveCard: (cardId, to, duringRest) => run(() => move({ characterId, cardId, to, duringRest })),
      setStatus: (s) => run(() => status({ characterId, status: s })),
      error,
    }),
    [character, characterId, hopeAndFear, run, updateSheet, adjustResource, damageMutation, move, status, error],
  );

  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>;
}
