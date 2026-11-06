import { Share } from "react-native";

import { formatJoinCode } from "./format-code";

const SITE = process.env.EXPO_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://dualityheart.com";

export function joinLinkForCode(code: string): string {
  return `${SITE}/join/${formatJoinCode(code)}`;
}

/**
 * Opens the system share sheet with the join link (React Native has no `navigator.clipboard`; the sheet offers Copy
 * as well as Messages, Mail and the rest). Resolves true when the link was shared, false when the sheet was dismissed.
 */
export async function shareJoinLink(link: string): Promise<boolean> {
  const result = await Share.share({ message: link });
  return result.action === Share.sharedAction;
}
