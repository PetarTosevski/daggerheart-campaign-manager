import { describe, expect, it } from "vitest";

import { requireUser } from "../../convex/lib/auth";
import { errorCode } from "./helpers";
import { makeTest } from "./setup";

const GM_EMAIL = "gm@example.com";

describe("requireUser", () => {
  it("returns the stored user for a stored user", async () => {
    const t = makeTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: GM_EMAIL }),
    );
    const asGm = t.withIdentity({ subject: `${userId}|session` });
    const user = await asGm.run((ctx) => requireUser(ctx));
    expect(user._id).toBe(userId);
  });

  it("returns any stored user, whatever the email (sign-up is open)", async () => {
    const t = makeTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "newcomer@example.com" }),
    );
    const asNew = t.withIdentity({ subject: `${userId}|session` });
    const user = await asNew.run((ctx) => requireUser(ctx));
    expect(user._id).toBe(userId);
  });

  it("throws FORBIDDEN when the user row was deleted", async () => {
    const t = makeTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: GM_EMAIL }),
    );
    await t.run((ctx) => ctx.db.delete("users", userId));
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
