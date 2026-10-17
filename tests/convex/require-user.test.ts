import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { requireUser } from "../../convex/lib/auth";
import { makeTest } from "./setup";

const GM_EMAIL = "gm@example.com";

function errorCode(error: unknown): unknown {
  return (error as { data?: unknown }).data;
}

describe("requireUser", () => {
  const previous = process.env.GM_EMAILS;
  beforeEach(() => {
    process.env.GM_EMAILS = GM_EMAIL;
  });
  afterEach(() => {
    process.env.GM_EMAILS = previous;
  });

  it("returns the stored user for an allowlisted user", async () => {
    const t = makeTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: GM_EMAIL }),
    );
    const asGm = t.withIdentity({ subject: `${userId}|session` });
    const user = await asGm.run((ctx) => requireUser(ctx));
    expect(user._id).toBe(userId);
  });

  it("throws FORBIDDEN for a stored user who is not allowlisted", async () => {
    const t = makeTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "intruder@example.com" }),
    );
    const asOther = t.withIdentity({ subject: `${userId}|session` });
    const error = await asOther.run((ctx) => requireUser(ctx)).catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
  });

  it("throws FORBIDDEN when the GM is removed from the allowlist", async () => {
    const t = makeTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: GM_EMAIL }),
    );
    process.env.GM_EMAILS = "someone-else@example.com";
    const asGm = t.withIdentity({ subject: `${userId}|session` });
    const error = await asGm.run((ctx) => requireUser(ctx)).catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
  });

  it("throws UNAUTHENTICATED without an identity", async () => {
    const t = makeTest();
    const error = await t.run((ctx) => requireUser(ctx)).catch((e) => e);
    expect(errorCode(error)).toBe("UNAUTHENTICATED");
  });
});
