import { type AdminAuditAction, type FeatureMode } from "@/lib/admin/config";
import { featureInfo, isFeatureKey } from "@/lib/admin/features";

import type { AdminTab } from "../slots";

/**
 * App admin, Overview tab (config AU1): the board's words (reference/designs/config/Admin.dc.html, `.s-ov`) and the
 * pure helpers that turn AD2's numbers, alert codes and audit rows into text. The server sends codes and values only
 * (convex/adminOverview.ts); every sentence is written here.
 */

export const OVERVIEW_TEXT = {
  campaignsTitle: "Campaigns",
  changesTitle: "Recent changes",
  changesHint: "Every change on this page is logged with who made it.",
  noCampaigns: "No campaigns yet.",
  noChanges: "No changes yet.",
  moreCampaigns: "Show more campaigns",
  moreChanges: "Show older changes",
  open: "Open",
  opening: "Opening …",
  loading: "Loading …",
} as const;

/** Rows per page of the campaigns card and Recent changes (the server clamps to 50). */
export const CAMPAIGNS_PAGE = 10;
export const CHANGES_PAGE = 20;

/** A name the server could not give (`users.name` empty): never the email. */
export const UNNAMED = "Unnamed account";

export function personName(name: string | null): string {
  return name?.trim() || UNNAMED;
}

/** The UTC day and month AD2's `stats` / `alerts` take (CF10). */
export function utcPeriods(now: number = Date.now()): { day: string; month: string } {
  const day = new Date(now).toISOString().slice(0, 10);
  return { day, month: day.slice(0, 7) };
}

/** A bounded count: "1000+" when the server stopped counting. */
export function countText(count: number, more: boolean): string {
  return more ? `${count}+` : String(count);
}

/** "$8.40" from micro-dollars. */
export function usd(micros: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(micros / 1_000_000);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------- tiles

export type OverviewStats = {
  accounts: { total: number; owner: number; gms: number; players: number; more: boolean };
  campaigns: { live: { count: number; more: boolean }; cap: number };
  lorekeeper: { questions: number; costMicros: number; limitMicros: number };
};

export type Tile = { label: string; value: string; detail: string };

/** The four tiles, in the board's order. */
export function statTiles(stats: OverviewStats): Tile[] {
  const { accounts, campaigns, lorekeeper } = stats;
  return [
    {
      label: "Accounts",
      value: countText(accounts.total, accounts.more),
      detail: `${plural(accounts.owner, "owner", "owners")} · ${accounts.gms} GM · ${plural(accounts.players, "player", "players")}`,
    },
    { label: "Campaigns", value: countText(campaigns.live.count, campaigns.live.more), detail: `of ${campaigns.cap} allowed` },
    { label: "Lorekeeper questions", value: String(lorekeeper.questions), detail: "this month" },
    { label: "Lorekeeper spend", value: usd(lorekeeper.costMicros), detail: `of ${usd(lorekeeper.limitMicros)} this month` },
  ];
}

// ---------------------------------------------------------------- alerts

export type OverviewAlert =
  | { code: "userNearDailyCap"; params: { userId: string; name: string | null; questions: number; cap: number } }
  | { code: "spendNearLimit"; params: { costMicros: number; limitMicros: number } }
  | { code: "spendAtLimit"; params: { costMicros: number; limitMicros: number } }
  | { code: "readOnly"; params: Record<string, never> }
  | { code: "keyMissing"; params: { service: "lorekeeper" | "email" } }
  | { code: "limitRequestsWaiting"; params: { count: number; more: boolean } };

export type AlertText = {
  title: string;
  detail: string;
  /** A button that selects another admin tab. */
  link?: { tab: AdminTab; label: string };
};

/** The text of one alert (the server sends `{ code, params }` only). */
export function alertText(alert: OverviewAlert): AlertText {
  switch (alert.code) {
    case "limitRequestsWaiting": {
      const { count, more } = alert.params;
      const n = countText(count, more);
      return {
        title: count === 1 && !more ? "1 GM is asking for higher Lorekeeper limits" : `${n} GMs are asking for higher Lorekeeper limits`,
        detail: "Approve with your own numbers or decline under Lorekeeper.",
        link: { tab: "lorekeeper", label: "Review requests" },
      };
    }
    case "readOnly":
      return {
        title: "The app is read-only",
        detail: "Everyone can read, but nothing can be changed until you turn it off.",
        link: { tab: "maintenance", label: "Maintenance" },
      };
    case "keyMissing":
      return alert.params.service === "lorekeeper"
        ? {
            title: "The Lorekeeper has no API key",
            detail: "The Lorekeeper can’t answer until the Anthropic API key is set in the deployment settings.",
            link: { tab: "maintenance", label: "Keys" },
          }
        : {
            title: "Email has no key",
            detail: "Invites and sign-in codes aren’t sent until the email key is set in the deployment settings.",
            link: { tab: "maintenance", label: "Keys" },
          };
    case "spendAtLimit":
      return {
        title: `Lorekeeper spend reached the monthly limit: ${usd(alert.params.costMicros)} of ${usd(alert.params.limitMicros)}`,
        detail: "The Lorekeeper now does what you chose for “When the limit is reached”. Resets on the 1st.",
        link: { tab: "lorekeeper", label: "Lorekeeper" },
      };
    case "spendNearLimit":
      return {
        title: `Lorekeeper spend is at ${usd(alert.params.costMicros)} of ${usd(alert.params.limitMicros)} this month`,
        detail: "Resets on the 1st. Raise the monthly limit under Lorekeeper if this keeps happening.",
        link: { tab: "lorekeeper", label: "Lorekeeper" },
      };
    case "userNearDailyCap":
      return {
        title: `${personName(alert.params.name)} is at ${alert.params.questions} of ${alert.params.cap} Lorekeeper questions today`,
        detail: "Resets at midnight (UTC). Raise the daily limit under Lorekeeper if this keeps happening.",
        link: { tab: "lorekeeper", label: "Lorekeeper" },
      };
  }
}

/** A stable React key for an alert. */
export function alertKey(alert: OverviewAlert): string {
  if (alert.code === "userNearDailyCap") return `${alert.code}:${alert.params.userId}`;
  if (alert.code === "keyMissing") return `${alert.code}:${alert.params.service}`;
  return alert.code;
}

// ---------------------------------------------------------------- campaigns card

export type CampaignRow = {
  campaignId: string;
  name: string;
  gmName: string | null;
  players: { count: number; more: boolean };
  archived: boolean;
  liveNow: boolean;
  lastPlayedAt: number | null;
};

/** "GM Mira · 3 players". */
export function campaignLine(row: CampaignRow): string {
  const players = row.players.more ? `${row.players.count}+ players` : plural(row.players.count, "player", "players");
  return `GM ${personName(row.gmName)} · ${players}`;
}

/** "Live now", "Last played 29 Oct", "Archived", "Not played yet". */
export function campaignStatus(row: CampaignRow, now: number = Date.now()): { text: string; live: boolean } {
  if (row.liveNow) return { text: "Live now", live: true };
  const played = row.lastPlayedAt === null ? "Not played yet" : `Last played ${shortDate(row.lastPlayedAt, now)}`;
  return { text: row.archived ? `Archived · ${played}` : played, live: false };
}

function shortDate(at: number, now: number): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(at);
}

// ---------------------------------------------------------------- recent changes

/** "2 Nov · 23:40" in the viewer's time zone (another year: "2 Nov 2025 · 23:40"). */
export function logTime(at: number, now: number = Date.now()): string {
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return `${shortDate(at, now)} · ${time}`;
}

export type AuditRow = {
  action: AdminAuditAction;
  actorName: string | null;
  field?: string;
  from?: string | number | boolean;
  to?: string | number | boolean;
  target?: string;
};

/** Actions anyone can cause (Q26 a); every other action is an owner-only mutation, so its actor is the viewer. */
const ANYONE_ACTIONS: ReadonlySet<AdminAuditAction> = new Set(["campaign.create", "campaign.delete", "campaign.restore"]);

/** Who did it: "You" for the owner's own changes, else the actor's name. */
export function logActor(row: AuditRow): string {
  return ANYONE_ACTIONS.has(row.action) ? personName(row.actorName) : "You";
}

const SIGN_UP: Record<string, string> = { invite: "Invite link only", open: "Open sign-up", closed: "Closed" };
const CAPS: Record<string, string> = {
  campaignsPerGm: "Campaigns per GM",
  campaignsApp: "Campaigns in the whole app",
  charactersPerPlayer: "Characters per player",
  playersPerCampaign: "Players per campaign",
};
const AT_LIMIT: Record<string, string> = { pause: "Pause the Lorekeeper", gmOnly: "GMs only", short: "Shorter answers" };
const MODES: Record<FeatureMode, string> = { off: "Off", owner: "Only me", testers: "Testers", everyone: "Everyone" };
const LIMIT_FIELDS: Record<string, string> = {
  dailyQuestions: "questions per day",
  dailyWebSearches: "internet searches per day",
  bookCount: "books",
  bookPages: "book pages",
};

function value(v: AuditRow["to"]): string {
  if (v === undefined) return "—";
  if (v === "default") return "the default";
  return String(v);
}

function lorekeeperChange(row: AuditRow): string {
  const to = row.to;
  switch (row.field) {
    case "monthlyUsd":
      return `set the Lorekeeper monthly spend limit to $${value(to)}`;
    case "campaignMonthlyUsd":
      return `set the Lorekeeper monthly limit per campaign to $${value(to)}`;
    case "dailyQuestions":
      return `set Lorekeeper questions per day to ${value(to)}`;
    case "dailyWebSearches":
      return `set internet searches per day to ${value(to)}`;
    case "atLimit":
      return `set “When the limit is reached” to ${AT_LIMIT[String(to)] ?? value(to)}`;
    case "allowGmRequests":
      return `turned “Let GMs ask for higher limits” ${to === true ? "on" : "off"}`;
    default:
      return `changed a Lorekeeper setting to ${value(to)}`;
  }
}

/** What happened, after the actor: "switched 3D dice to Everyone". */
export function logText(row: AuditRow): string {
  switch (row.action) {
    case "owner.set":
      return "became the app owner";
    case "signUpMode.set":
      return `set New accounts to ${SIGN_UP[String(row.to)] ?? value(row.to)}`;
    case "cap.set":
      return `set ${CAPS[row.field ?? ""] ?? "a limit"} to ${value(row.to)}`;
    case "tester.add":
      return "added a tester";
    case "tester.remove":
      return "removed a tester";
    case "lorekeeper.set":
      return lorekeeperChange(row);
    case "library.upload":
      return "uploaded a book to the library";
    case "library.replace":
      return "replaced a book in the library";
    case "library.remove":
      return "removed a book from the library";
    case "feature.set": {
      const name = row.field !== undefined && isFeatureKey(row.field) ? featureInfo(row.field).name : "a feature";
      return `switched ${name} to ${MODES[String(row.to) as FeatureMode] ?? value(row.to)}`;
    }
    case "readOnly.set":
      return `turned read-only ${row.to === true ? "on" : "off"}`;
    case "export.request":
      return "exported everything";
    case "limits.request.approve":
      return `approved a limit request: ${LIMIT_FIELDS[row.field ?? ""] ?? "a limit"} ${value(row.to)}`;
    case "limits.request.decline":
      return "declined a limit request";
    case "limits.campaign.set":
      return `set a campaign’s ${LIMIT_FIELDS[row.field ?? ""] ?? "limit"} to ${value(row.to)}`;
    case "campaign.view":
      return "opened a campaign from App admin";
    case "account.suspend":
      return "suspended an account";
    case "account.unsuspend":
      return "lifted a suspension";
    case "account.delete":
      return "deleted an account";
    case "account.restore":
      return "restored an account";
    case "campaign.create":
      return "created a campaign";
    case "campaign.delete":
      return "deleted a campaign";
    case "campaign.restore":
      return "restored a campaign";
  }
}
