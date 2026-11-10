import type { Id } from "../../../convex/_generated/dataModel";
import { DRAFT_SCHEMA_VERSION, type DraftKind } from "../config/preferences";
import * as z from "../zod";

import { emptyWizard, restoreWizard, type WizardState } from "./wizard-logic";

/**
 * The pure half of unsent drafts on the account (config U6f, Q15 b): the stored envelope's parser, the character
 * wizard's draft schema and which wizard fields are typed (debounced saves). Framework-free (no React, no "@/"), shared
 * by the website (party/new/draft.ts holds its `useAccountDraft` hook) and the phone app.
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

/** Which draft a `drafts.get` / `drafts.save` / `drafts.clear` call is about. */
export type DraftScope =
  | { kind: "characterWizard"; campaignId: Id<"campaigns"> }
  | { kind: Extract<DraftKind, "customFrame"> }
  | { kind: "levelUp"; characterId: Id<"characters"> };
