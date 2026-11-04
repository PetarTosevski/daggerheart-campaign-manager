import {
  CAP_KEYS,
  DEFAULT_CAPS,
  DEFAULT_LOREKEEPER,
  DEFAULT_SIGN_UP_MODE,
  type Caps,
  type LorekeeperSettings,
  type SignUpMode,
} from "../../src/lib/admin/config";
import type { Doc } from "../_generated/dataModel";
import { env, type QueryCtx } from "../_generated/server";
import { appConfigRow } from "./appOwner";

/**
 * The app's effective settings (config AD0): the owner's saved values over the defaults. The Lorekeeper numbers fall
 * back to today's env vars (`LOREKEEPER_MONTHLY_USD`, `LOREKEEPER_CAMPAIGN_MONTHLY_USD`, `LOREKEEPER_DAILY_QUESTIONS`)
 * and then the code defaults, so nothing changes until the owner saves something. Env vars are read in the call
 * (CF19). The result holds settings only: never the owner id, a key or an env value other than these numbers.
 */
export type AppSettings = {
  signUpMode: SignUpMode;
  caps: Caps;
  lorekeeper: LorekeeperSettings;
  /** The UTC month the 80% spend email was last sent (AD7), or null. */
  spendAlertMonth: string | null;
};

/** A non-negative number from an env var, else the fallback (a typo never opens or closes a gate). */
function envNumber(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  const value = Number(trimmed);
  return trimmed && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** A saved number when it is a finite non-negative number, else the fallback. */
function saved(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** The settings from a stored row (or none); pure apart from the env read, so tests can call it directly. */
export function settingsFrom(row: Doc<"appConfig"> | null): AppSettings {
  const caps = Object.fromEntries(CAP_KEYS.map((key) => [key, Math.floor(saved(row?.caps?.[key], DEFAULT_CAPS[key]))])) as Caps;
  const lk = row?.lorekeeper;
  return {
    signUpMode: row?.signUpMode ?? DEFAULT_SIGN_UP_MODE,
    caps,
    lorekeeper: {
      monthlyUsd: saved(lk?.monthlyUsd, envNumber(env.LOREKEEPER_MONTHLY_USD, DEFAULT_LOREKEEPER.monthlyUsd)),
      campaignMonthlyUsd: saved(
        lk?.campaignMonthlyUsd,
        envNumber(env.LOREKEEPER_CAMPAIGN_MONTHLY_USD, DEFAULT_LOREKEEPER.campaignMonthlyUsd),
      ),
      dailyQuestions: Math.floor(saved(lk?.dailyQuestions, envNumber(env.LOREKEEPER_DAILY_QUESTIONS, DEFAULT_LOREKEEPER.dailyQuestions))),
      dailyWebSearches: Math.floor(saved(lk?.dailyWebSearches, DEFAULT_LOREKEEPER.dailyWebSearches)),
      atLimit: lk?.atLimit ?? DEFAULT_LOREKEEPER.atLimit,
      allowGmRequests: lk?.allowGmRequests ?? DEFAULT_LOREKEEPER.allowGmRequests,
    },
    spendAlertMonth: row?.spendAlertMonth ?? null,
  };
}

/** The app's effective settings, read in the caller's transaction. */
export async function readAppConfig(ctx: QueryCtx): Promise<AppSettings> {
  return settingsFrom(await appConfigRow(ctx));
}
