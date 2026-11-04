"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useRef } from "react";
import { z } from "zod";

import { DRAFT_MAX_BYTES, DRAFT_SCHEMA_VERSION, utf8Bytes, type DraftKind } from "@/lib/config/preferences";

import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { emptyWizard, restoreWizard, type WizardState } from "./wizard-logic";

/**
 * Unsent drafts on the account (config U6f, Q15 b): the character wizard (one per campaign) and the custom frame form
 * keep their draft in `userDrafts` (`convex/drafts.ts`), so another device picks it up. A stored draft is read once,
 * when the form opens, through a zod parser; a draft of another `schemaVersion` or shape is ignored (the form starts
 * empty). Saves go out from the change handlers (rule 13): typing is debounced (`DRAFT_DEBOUNCE_MS` after the last
 * key), a click (a choice, a step change) saves at once.
 */

/** How long after the last keystroke a typed change is saved. */
export const DRAFT_DEBOUNCE_MS = 1000;

/** The stored envelope: the current version and JSON text of an object. */
const envelope = z.object({ schemaVersion: z.literal(DRAFT_SCHEMA_VERSION), data: z.string() });

/** The draft's object from what `drafts.get` returned, or null when there is none or it fails `schema`. */
export function parseDraft<T>(stored: unknown, schema: z.ZodType<T>): T | null {
  const outer = envelope.safeParse(stored);
  if (!outer.success) return null;
  let json: unknown;
  try {
    json = JSON.parse(outer.data.data);
  } catch {
    return null;
  }
  const inner = schema.safeParse(json);
  return inner.success ? inner.data : null;
}

const text = z.string();
const id = z.string().nullable();
const strings = z.array(z.string());

/** The wizard state as stored (schemaVersion 1); `restoreWizard` then clamps the values. */
export const wizardDraftSchema = z.object({
  step: z.number().int(),
  classId: id,
  subclassId: id,
  ancestryMode: z.enum(["single", "mixed", "shapeshifter"]).nullable(),
  ancestryId: id,
  mixedFirst: id,
  mixedSecond: id,
  mixedName: text,
  shapeForm: id,
  shapeFeature: id,
  communityId: id,
  traits: z.record(z.string(), z.number()),
  name: text,
  pronouns: text,
  pronounsLabel: z.enum(["gender", "pronouns"]),
  description: text,
  portrait: id,
  primaryWeaponId: id,
  secondaryWeaponId: id,
  armorId: id,
  potion: id,
  classItem: id,
  background: strings,
  experiences: strings,
  purposefulExperience: z.union([z.literal(0), z.literal(1)]).nullable(),
  domainCards: strings,
  connections: strings,
  ownerId: id,
  ikonis: z.unknown().optional(),
});

/** The wizard's starting state from the stored draft: the draft when it parses, else an empty wizard. */
export function wizardFromDraft(stored: unknown): WizardState {
  const draft = parseDraft(stored, wizardDraftSchema);
  return draft === null ? emptyWizard() : restoreWizard(draft);
}

/** The wizard fields a player types into; a change to any other field is a click and saves at once. */
const WIZARD_TYPED: ReadonlySet<keyof WizardState> = new Set<keyof WizardState>([
  "name",
  "pronouns",
  "description",
  "mixedName",
  "experiences",
  "background",
  "connections",
  "ikonis",
]);

/** True when a wizard patch only touches typed fields (so its save waits for the typing to stop). */
export function isTypedWizardPatch(patch: Partial<WizardState>): boolean {
  const keys = Object.keys(patch) as (keyof WizardState)[];
  return keys.length > 0 && keys.every((k) => WIZARD_TYPED.has(k));
}

export type DraftScope =
  | { kind: "characterWizard"; campaignId: Id<"campaigns"> }
  | { kind: Extract<DraftKind, "customFrame"> }
  | { kind: "levelUp"; characterId: Id<"characters"> };

/**
 * The caller's draft of `scope`: `stored` is undefined while it loads (or while `enabled` is false: the query is
 * skipped, for a viewer who may not read the draft), then `drafts.get`'s answer (parse it with `parseDraft`).
 * `save(data, { typed })` writes the draft (debounced when `typed`), `flush()` sends a waiting save now, `clear()`
 * drops any waiting save and deletes the draft. A refused or failed save is dropped: a draft is a convenience, and
 * the next change saves again. The three actions keep their identity while the scope is the same.
 */
export function useAccountDraft(scope: DraftScope, { enabled = true }: { enabled?: boolean } = {}) {
  const stored = useQuery(api.drafts.get, enabled ? scope : "skip");
  const saveDraft = useMutation(api.drafts.save);
  const clearDraft = useMutation(api.drafts.clear);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef<string | null>(null);
  const scopeKey = JSON.stringify(scope);

  const actions = useMemo(() => {
    const target = JSON.parse(scopeKey) as DraftScope;

    const cancel = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      waiting.current = null;
    };

    const flush = () => {
      const data = waiting.current;
      cancel();
      if (data === null) return;
      saveDraft({ ...target, schemaVersion: DRAFT_SCHEMA_VERSION, data }).catch(() => undefined);
    };

    const save = (value: object, { typed = false }: { typed?: boolean } = {}) => {
      const data = JSON.stringify(value);
      if (utf8Bytes(data) > DRAFT_MAX_BYTES) return; // the server refuses it; keep the last saved draft
      if (timer.current !== null) clearTimeout(timer.current);
      waiting.current = data;
      if (typed) timer.current = setTimeout(flush, DRAFT_DEBOUNCE_MS);
      else flush();
    };

    const clear = () => {
      cancel();
      clearDraft(target).catch(() => undefined);
    };

    return { save, flush, clear };
  }, [scopeKey, saveDraft, clearDraft]);

  return { stored, ...actions };
}
