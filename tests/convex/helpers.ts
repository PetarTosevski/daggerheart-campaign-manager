import { api } from "../../convex/_generated/api";
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
