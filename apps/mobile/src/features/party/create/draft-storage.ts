import * as SecureStore from "expo-secure-store";

import { emptyWizard, restoreWizard, type WizardState } from "./wizard-logic";

const key = (campaignId: string) => `dh.characterWizard.${campaignId}`;

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
