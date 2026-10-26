import { afterEach, beforeEach } from "vitest";

import { api } from "../../convex/_generated/api";
import { makeTest } from "./setup";

export const GM_EMAIL = "gm@example.com";
export const OTHER_EMAIL = "other@example.com";

/** Allowlists the test accounts (both by default) for the duration of each test. */
export function useAllowlist(emails = `${GM_EMAIL},${OTHER_EMAIL}`) {
  const previous = process.env.ALLOWED_EMAILS;
  beforeEach(() => {
    process.env.ALLOWED_EMAILS = emails;
  });
  afterEach(() => {
    process.env.ALLOWED_EMAILS = previous;
  });
}

export function errorData(error: unknown): unknown {
  return (error as { data?: unknown }).data;
}

/** The error code from a ConvexError carrying either a string or `{ code }`. */
export function errorCode(error: unknown): unknown {
  const data = errorData(error);
  return typeof data === "object" && data !== null ? (data as { code?: unknown }).code : data;
}

let keys = 0;
export const key = () => `key-${++keys}`;

export async function setupWithCampaign(frameId: "witherwild" | "beast-feast" = "witherwild") {
  const t = makeTest();
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM_EMAIL, emailVerificationTime: 1 }));
  const otherId = await t.run((ctx) => ctx.db.insert("users", { email: OTHER_EMAIL, emailVerificationTime: 1 }));
  const gm = t.withIdentity({ subject: `${gmId}|session` });
  const other = t.withIdentity({ subject: `${otherId}|session` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Test", idempotencyKey: key() });
  return { t, gm, other, campaignId };
}
