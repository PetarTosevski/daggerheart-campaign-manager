/**
 * App admin (config plan Part B, AD0): the owner's settings and their defaults, shared by the server
 * (`convex/lib/appConfig.ts`, the validators in `convex/lib/validators/admin.ts`) and the admin pages. A missing value
 * in `appConfig` means the default below, so nothing changes until the owner saves something.
 */

/** Who may create a new account (Q18 a): open sign-up stays the default. */
export const SIGN_UP_MODES = ["open", "invite", "closed"] as const;
export type SignUpMode = (typeof SIGN_UP_MODES)[number];
export const DEFAULT_SIGN_UP_MODE: SignUpMode = "open";

/** The four app-wide caps (Q19 a). */
export const CAP_KEYS = ["campaignsPerGm", "campaignsApp", "charactersPerPlayer", "playersPerCampaign"] as const;
export type CapKey = (typeof CAP_KEYS)[number];
export type Caps = Record<CapKey, number>;

/**
 * Q19 a: campaigns per GM 10, campaigns in the app 100, characters per player per campaign 5 (retired included),
 * players per campaign 8 (co-GMs count, the creator doesn't). The caps apply to the owner too.
 */
export const DEFAULT_CAPS: Caps = {
  campaignsPerGm: 10,
  campaignsApp: 100,
  charactersPerPlayer: 5,
  playersPerCampaign: 8,
};

/** What happens when the Lorekeeper's monthly spend limit is reached (Q20 a): pause, GMs only, or shorter answers. */
export const AT_LIMIT_MODES = ["pause", "gmOnly", "short"] as const;
export type AtLimitMode = (typeof AT_LIMIT_MODES)[number];

/** The Lorekeeper settings the owner can change (AD6). Money in US dollars. */
export type LorekeeperSettings = {
  /** The whole app's monthly spend limit (today's env `LOREKEEPER_MONTHLY_USD`, default 150). */
  monthlyUsd: number;
  /** One campaign's monthly spend limit (today's env `LOREKEEPER_CAMPAIGN_MONTHLY_USD`, default 50). */
  campaignMonthlyUsd: number;
  /** Questions per person per UTC day (today's env `LOREKEEPER_DAILY_QUESTIONS`, default 40). */
  dailyQuestions: number;
  /** Internet searches per person per UTC day (new in AD6; no env var). */
  dailyWebSearches: number;
  atLimit: AtLimitMode;
  /** "Let GMs ask for higher limits · You approve each request" (Q21 changed, N10). */
  allowGmRequests: boolean;
  /** "Email me at 80%" (AD7, Q32 a): the month's first crossing of 80% of the monthly limit emails the owner. */
  emailAt80: boolean;
};

/** The code defaults, used when neither the owner's setting nor the env var is there. */
export const DEFAULT_LOREKEEPER: LorekeeperSettings = {
  monthlyUsd: 150,
  campaignMonthlyUsd: 50,
  dailyQuestions: 40,
  dailyWebSearches: 20,
  atLimit: "pause",
  allowGmRequests: false,
  emailAt80: true,
};

/** Who a feature switch turns a feature on for (Q25). A missing switch means `everyone` (what ships today). */
export const FEATURE_MODES = ["off", "owner", "testers", "everyone"] as const;
export type FeatureMode = (typeof FEATURE_MODES)[number];

/**
 * Every action an `adminAudit` row can record, including the later tracers' (rule 7: the union is complete from the
 * start, so no tracer edits the stored validator in place). Q26 a: admin changes plus campaigns created / deleted.
 */
export const ADMIN_AUDIT_ACTIONS = [
  // AD0: the owner was named with `npx convex run adminSetup:setOwner`.
  "owner.set",
  // AD3: accounts.
  "signUpMode.set",
  "cap.set",
  "tester.add",
  "tester.remove",
  // AD6: Lorekeeper budget settings (`field` names the setting).
  "lorekeeper.set",
  // AD8: the owner's book library.
  "library.upload",
  "library.replace",
  "library.remove",
  // AD9: feature switches (`field` names the feature).
  "feature.set",
  // AD10: maintenance.
  "readOnly.set",
  // AD11: export everything.
  "export.request",
  // AD12: GM requests for higher Lorekeeper limits.
  "limits.request.approve",
  "limits.request.decline",
  "limits.campaign.set",
  // AD13: the owner opened someone else's campaign read-only.
  "campaign.view",
  // AD14: accounts suspended, lifted, deleted (30-day undo).
  "account.suspend",
  "account.unsuspend",
  "account.delete",
  "account.restore",
  // Q26 a: campaigns created and deleted (by anyone).
  "campaign.create",
  "campaign.delete",
  "campaign.restore",
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

/** Audit rows are kept for a year (Q26 a). */
export const ADMIN_AUDIT_TTL_DAYS = 365;

/** A temporary export file lives one hour (Q30 a). */
export const ADMIN_EXPORT_TTL_MINUTES = 60;

export const ADMIN_EXPORT_STATUSES = ["pending", "ready", "failed"] as const;
export type AdminExportStatus = (typeof ADMIN_EXPORT_STATUSES)[number];

/** A GM's request for higher Lorekeeper limits (Q21 changed, N10): the owner approves or declines. */
export const LIMIT_REQUEST_STATUSES = ["pending", "approved", "declined"] as const;
export type LimitRequestStatus = (typeof LIMIT_REQUEST_STATUSES)[number];

/** A request's reason, at most this many characters. */
export const LIMIT_REQUEST_REASON_MAX = 300;

/** Decided requests are kept for a year, like the audit. */
export const LIMIT_REQUEST_TTL_DAYS = 365;
