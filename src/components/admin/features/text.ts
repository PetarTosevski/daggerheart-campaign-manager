import type { FeatureMode } from "@/lib/admin/config";

/** The board's text for the Feature switches tab (reference/designs/config/Admin.dc.html, `.s-flags`). */
export const FEATURES_TEXT = {
  title: "Feature switches",
  intro: "Turn new parts of the app on for yourself first, then testers, then everyone. Nothing is lost when a feature is off.",
  testersTitle: "Testers",
  testersHint: "See features set to Testers.",
  noTesters: "No testers yet",
  edit: "Edit",
  pickerTitle: "Testers",
  pickerIntro: "Testers see the features set to Testers. You always see them.",
  more: "Show more accounts",
  olderNotLoaded: "Older accounts are not loaded yet; Edit shows them.",
  noAccounts: "No other accounts yet.",
  loading: "Loading …",
} as const;

/** The four-way choice, in the board's order. */
export const MODE_LABEL: Record<FeatureMode, string> = { off: "Off", owner: "Only me", testers: "Testers", everyone: "Everyone" };

/** "Changed 2 Nov" (another year: "Changed 2 Nov 2025"); never saved: "Changed —". */
export function changedLabel(changedAt: number | null, now: number = Date.now()): string {
  if (changedAt === null) return "Changed —";
  const date = new Date(changedAt);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const text = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
  return `Changed ${text}`;
}

/** "Luka", "Luka and Mira", "Luka, Mira and Ana". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** An account's name on the page: the name, else the email, else a placeholder. */
export function accountName(account: { name: string | null; email: string | null }): string {
  return account.name?.trim() || account.email || "Unnamed account";
}
