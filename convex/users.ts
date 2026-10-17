import { query } from "./_generated/server";
import { requireUser } from "./lib/auth";

/** The signed-in GM, for the app shell. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return { email: user.email ?? null, name: user.name ?? null };
  },
});
