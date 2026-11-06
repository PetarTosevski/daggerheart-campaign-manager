import type { CapKey, SignUpMode } from "@/lib/admin/config";

/**
 * App admin, Accounts tab (config AU2): the board's words (reference/designs/config/Admin.dc.html, `.s-acc`) and the
 * small pure helpers the tab and its tests share.
 */

export const JOIN_TITLE = "Who can join";

export const SIGN_UP_LABEL = "New accounts";
export const SIGN_UP_HINT = "How people get into the app.";

/** The segmented choice, in the board's order. */
export const SIGN_UP_OPTIONS: readonly { mode: SignUpMode; label: string }[] = [
  { mode: "invite", label: "Invite link only" },
  { mode: "open", label: "Open sign-up" },
  { mode: "closed", label: "Closed" },
];

/** The four caps' steppers, in the board's order (Players per campaign has no hint on the board). */
export const CAP_ROWS: readonly { cap: CapKey; label: string; hint?: string }[] = [
  { cap: "campaignsPerGm", label: "Campaigns per GM", hint: "Archived campaigns don’t count." },
  { cap: "campaignsApp", label: "Campaigns in the whole app", hint: "New campaigns are refused past this." },
  { cap: "charactersPerPlayer", label: "Characters per player in a campaign", hint: "Includes retired characters." },
  { cap: "playersPerCampaign", label: "Players per campaign" },
];

/** convex/adminAccounts.ts CAP_MIN / CAP_MAX (the server refuses anything else with INVALID). */
export const CAP_MIN = 1;
export const CAP_MAX = 1000;

export const ACCOUNTS_TITLE = "Accounts";
/** One page of the account table (the server clamps to 50). */
export const ACCOUNTS_PAGE = 25;

export const ROLE_LABEL = { owner: "Owner", gm: "GM", player: "Player" } as const;

export const ADD_TESTER = "Add to testers";
export const REMOVE_TESTER = "Remove from testers";

/** The name a row shows: the owner's own row is "You" (there is one owner, and only the owner sees this page). */
export function accountName(row: { role: string; name: string | null; email: string | null }): string {
  if (row.role === "owner") return "You";
  return row.name?.trim() || row.email || "Unnamed account";
}

/** The initial in the avatar circle. */
export function accountInitial(row: { role: string; name: string | null; email: string | null }): string {
  return (accountName(row).trim()[0] ?? "?").toUpperCase();
}

/** "The Witherwild, Age of Umbra", "… and more" when the server cut the list, "None" when there are none. */
export function campaignList(campaigns: readonly string[], more: boolean): string {
  if (campaigns.length === 0) return more ? "More than shown" : "None";
  return more ? `${campaigns.join(", ")} and more` : campaigns.join(", ");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Now" / "12 min ago" / "2 h ago" / "1 day ago" / "29 Oct" (past 30 days) / "Never". */
export function lastSeenText(lastSeen: number | null, now: number): string {
  if (lastSeen === null) return "Never";
  const ago = Math.max(0, now - lastSeen);
  if (ago < 5 * MINUTE) return "Now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
  const days = Math.floor(ago / DAY);
  if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`;
  return new Date(lastSeen).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** A stepper's next value, kept inside CAP_MIN..CAP_MAX. */
export function steppedCap(value: number, delta: number): number {
  return Math.min(CAP_MAX, Math.max(CAP_MIN, value + delta));
}
