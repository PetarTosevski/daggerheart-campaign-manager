import { query } from "./_generated/server";
import { requireGm } from "./lib/auth";

/** The signed-in GM, for the app shell. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireGm(ctx);
    return { email: user.email ?? null, name: user.name ?? null };
  },
});
