import { Share } from "react-native";

import { formatJoinCode } from "./format-code";

const SITE = process.env.EXPO_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://dualityheart.com";

export function joinLinkForCode(code: string): string {
  return `${SITE}/join/${formatJoinCode(code)}`;
}

/**
 * Copies text when a clipboard API exists (web and some test environments); on a phone it always throws, as React
 * Native has no `navigator.clipboard`. Kept only for the Lorekeeper's Copy (`lorekeeper/answer-card.tsx`), which
 * should move to `Share` or expo-clipboard in its own tracer; new code uses `shareJoinLink`.
 */
export async function copyToClipboard(text: string): Promise<void> {
  const nav = globalThis.navigator as { clipboard?: { writeText: (value: string) => Promise<void> } } | undefined;
  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard is not available on this device.");
}

/**
 * Opens the system share sheet with the join link (React Native has no `navigator.clipboard`; the sheet offers Copy
 * as well as Messages, Mail and the rest). Resolves true when the link was shared, false when the sheet was dismissed.
 */
export async function shareJoinLink(link: string): Promise<boolean> {
  const result = await Share.share({ message: link });
  return result.action === Share.sharedAction;
}
