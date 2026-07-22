import { describe, expect, it } from "vitest";

import { createCampaignSchema } from "@/lib/validation/campaigns";

describe("createCampaignSchema", () => {
  it("accepts a valid name and trims it", () => {
    const result = createCampaignSchema.safeParse({
      name: "  The Witherwild  ",
      description: "  a note ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("The Witherwild");
      expect(result.data.description).toBe("a note");
    }
  });

  it("allows an empty description", () => {
    const result = createCampaignSchema.safeParse({ name: "Camp", description: "" });
    expect(result.success).toBe(true);
  });

  it("rejects a whitespace-only name", () => {
    const result = createCampaignSchema.safeParse({ name: "   ", description: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/enter a campaign name/i);
    }
  });

  it("rejects an empty name", () => {
    expect(
      createCampaignSchema.safeParse({ name: "", description: "" }).success,
    ).toBe(false);
  });

  it("rejects a name longer than 100 characters", () => {
    expect(
      createCampaignSchema.safeParse({ name: "a".repeat(101), description: "" })
        .success,
    ).toBe(false);
  });
});
