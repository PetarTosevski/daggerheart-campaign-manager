import { describe, expect, it } from "vitest";

import { makeTest } from "./setup";

// Phase 1 spike (a): later atomicity tests rely on `t.run` discarding the
// writes of a callback that throws, the way a failing mutation does.
describe("convex-test t.run", () => {
  it("rolls back writes when the callback throws", async () => {
    const t = makeTest();
    await t
      .run(async (ctx) => {
        await ctx.db.insert("users", { email: "rolled-back@example.com" });
        throw new Error("boom");
      })
      .catch(() => undefined);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toEqual([]);
  });
});
