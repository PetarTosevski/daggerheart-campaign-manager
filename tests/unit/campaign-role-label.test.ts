/** Load Campaign's role badge (dcm-6dtb): the creator, a co-GM and a player each get their own label. */
import { describe, expect, it } from "vitest";

import { campaignRoleLabel } from "@/lib/campaign-display";

describe("campaignRoleLabel", () => {
  it("labels the creator, a co-GM and a player", () => {
    expect(campaignRoleLabel({ role: "gm", isCreator: true })).toBe("Game Master");
    expect(campaignRoleLabel({ role: "gm", isCreator: false })).toBe("Co-GM");
    expect(campaignRoleLabel({ role: "player", isCreator: false })).toBe("Player");
  });
});
