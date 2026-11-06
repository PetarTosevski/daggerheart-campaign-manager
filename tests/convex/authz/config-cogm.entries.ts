import { api } from "../../../convex/_generated/api";
import type { Area } from "./harness";

/**
 * Authz matrix: config co-GM (plan `.omc/plans/config.yaml`, tracer G1; docs/tasks/TASK-CONFIG-G1.md). The world's
 * `coGm` is a member the GM promoted; the GM is the campaign's creator. Promoting and demoting co-GMs is the creator's
 * alone (Q7 a): a co-GM, who passes every GM wrapper, is FORBIDDEN here. Behaviour (not-member, idempotence, demotion)
 * is in tests/convex/co-gm.test.ts.
 */
const area: Area = {
  area: "config-cogm",
  entries: [
    // Promote playerB. Every row states its outcome so the creator-only rule is visible here, not only in the class.
    {
      fn: api.members.setCoGm,
      access: "creator",
      args: (w) => ({ userId: w.users.otherPlayer, coGm: true }),
      expect: {
        anon: "UNAUTHENTICATED",
        outsider: "NOT_FOUND",
        otherPlayer: "FORBIDDEN",
        player: "FORBIDDEN",
        grantee: "FORBIDDEN",
        coGm: "FORBIDDEN",
        gm: "ok",
      },
    },
  ],
};

export default area;
