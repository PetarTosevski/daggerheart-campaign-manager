import { getFunctionName } from "convex/server";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

export const GM_EMAIL = "gm@example.com";
export const OTHER_EMAIL = "other@example.com";

/**
 * Deprecated no-op kept so the many test files that call it still compile:
 * sign-up is open, so no test needs an allowlist. Delete the calls over time.
 */
export function useAllowlist(emails?: string) {
  void emails;
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

/** The player acts the GM hands the spotlight back before (`handingBack`): every non-reaction act S2 can refuse. */
const PLAYER_ACTS = new Set([
  "combatActions:attack",
  "combatCards:useCard",
  "combatFeatures:useFeature",
  "rolls:actionRoll",
  "rolls:manualRoll",
  "rolls:tagTeam",
  "combatTokens:move",
  "characters:moveCard",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any convex-test client (its mutation is generic).
type MutationClient = { mutation: (...args: any[]) => Promise<any> };

/**
 * S2 (plan rule-switches RS2): a roll with Fear or a failure hands the spotlight to the GM, and in a running encounter
 * players then wait (SPOTLIGHT_WITH_GM). For tests about something else that act again right after such a roll: the
 * returned client is `client`, except that before each player act (`PLAYER_ACTS`) the GM hands the spotlight to the
 * party (`combatSpotlight.handToParty`, nothing when nobody holds it). Waiting itself: rules-spotlight-wait.test.ts.
 */
export function handingBack<C extends MutationClient>(client: C, gm: MutationClient, campaignId: Id<"campaigns">): C {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "mutation") return Reflect.get(target, prop, receiver) as unknown;
      return async (ref: Parameters<typeof getFunctionName>[0], ...rest: unknown[]) => {
        if (PLAYER_ACTS.has(getFunctionName(ref))) await gm.mutation(api.combatSpotlight.handToParty, { campaignId, idempotencyKey: key() });
        return target.mutation(ref, ...rest);
      };
    },
  });
}

export async function setupWithCampaign(frameId: "witherwild" | "beast-feast" = "witherwild") {
  const t = makeTest();
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM_EMAIL, emailVerificationTime: 1 }));
  const otherId = await t.run((ctx) => ctx.db.insert("users", { email: OTHER_EMAIL, emailVerificationTime: 1 }));
  const gm = t.withIdentity({ subject: `${gmId}|session` });
  const other = t.withIdentity({ subject: `${otherId}|session` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Test", idempotencyKey: key() });
  return { t, gm, other, campaignId };
}

const IMAGE_MAGIC: Record<string, readonly number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/gif": [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
};

/**
 * `size` bytes (at least 12) that start with `contentType`'s magic number, so an attached test upload passes the
 * scheduled byte check (CF16, `convex/lib/files.ts`). Other types get zero bytes.
 */
export function imageBytes(contentType = "image/png", size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.max(size, 12));
  bytes.set(IMAGE_MAGIC[contentType] ?? []);
  return bytes;
}

/** A Blob of `imageBytes(contentType, size)` with that type. */
export const imageBlob = (contentType = "image/png", size = 64) => new Blob([imageBytes(contentType, size)], { type: contentType });
