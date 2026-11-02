import { formatJoinCode } from "./format-code";

const SITE = process.env.EXPO_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://dualityheart.com";

export function joinLinkForCode(code: string): string {
  return `${SITE}/join/${formatJoinCode(code)}`;
}

/** Copies text when a clipboard API exists (web and some test environments). */
export async function copyToClipboard(text: string): Promise<void> {
  const nav = globalThis.navigator as { clipboard?: { writeText: (value: string) => Promise<void> } } | undefined;
  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard is not available on this device.");
}
