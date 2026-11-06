import * as SecureStore from "expo-secure-store";

import { emptyWizard, restoreWizard, type WizardState } from "./wizard-logic";

const key = (campaignId: string) => `dh.characterWizard.${campaignId}`;

/** How long after the last keystroke a typed change is saved (dcm-gdzi.26: not one write per keystroke). */
export const DRAFT_DEBOUNCE_MS = 500;

/** The wizard fields a player types into; a change to any other field is a tap and saves at once (the website's rule). */
const TYPED: ReadonlySet<keyof WizardState> = new Set<keyof WizardState>([
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
export function isTypedPatch(patch: Partial<WizardState>): boolean {
  const keys = Object.keys(patch) as (keyof WizardState)[];
  return keys.length > 0 && keys.every((k) => TYPED.has(k));
}

/** Loads a per-device draft; missing or bad storage yields a fresh wizard. */
export async function loadWizardDraft(campaignId: string): Promise<WizardState> {
  try {
    const raw = await SecureStore.getItemAsync(key(campaignId));
    if (!raw) return emptyWizard();
    return restoreWizard(JSON.parse(raw));
  } catch {
    return emptyWizard();
  }
}

export async function saveWizardDraft(campaignId: string, state: WizardState | null): Promise<void> {
  try {
    if (state) await SecureStore.setItemAsync(key(campaignId), JSON.stringify(state));
    else await SecureStore.deleteItemAsync(key(campaignId));
  } catch {
    // Storage unavailable: the draft just is not kept.
  }
}

export type DraftSaver = {
  /** Saves `state`: at once for a tap, `DRAFT_DEBOUNCE_MS` after the last keystroke for typing. */
  save: (state: WizardState, options: { typed: boolean }) => void;
  /** Drops any pending save and deletes the stored draft. */
  clear: () => Promise<void>;
  /** Writes a pending typed save now (leaving the screen). */
  flush: () => void;
};

/**
 * The wizard's draft writer, called from the change handlers (rule 13: never from an effect). Typing is debounced, a tap
 * saves at once; only the latest state is ever written.
 */
export function createDraftSaver(campaignId: string, delay = DRAFT_DEBOUNCE_MS): DraftSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: WizardState | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = () => {
    cancel();
    if (pending === null) return;
    const state = pending;
    pending = null;
    void saveWizardDraft(campaignId, state);
  };
  return {
    save(state, { typed }) {
      pending = state;
      if (!typed) return flush();
      cancel();
      timer = setTimeout(flush, delay);
    },
    async clear() {
      cancel();
      pending = null;
      await saveWizardDraft(campaignId, null);
    },
    flush,
  };
}
