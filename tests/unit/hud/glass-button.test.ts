import { describe, expect, it } from "vitest";

import { glassButtonClass } from "@/components/brand/glass-button";
import { hudButtonClass } from "@/components/combat-map/hud/ui";

describe("glassButtonClass", () => {
  it("names the role, then the optional tone, size and shape", () => {
    expect(glassButtonClass({ role: "confirm" })).toBe("gb gb-confirm");
    expect(glassButtonClass({ role: "cancel", tone: "hope", size: "sm" })).toBe("gb gb-cancel gb-hope gb-sm");
    expect(glassButtonClass({ role: "cancel", icon: true, round: true })).toBe("gb gb-cancel gb-icon gb-round");
    expect(glassButtonClass({ role: "confirm", size: "lg", wrap: true })).toBe("gb gb-confirm gb-lg gb-wrap");
  });

  it("never wraps unless asked, so the HUD's buttons keep the design's fixed height", () => {
    expect(glassButtonClass({ role: "neutral", size: "sm" })).not.toContain("gb-wrap");
  });
});

describe("hudButtonClass", () => {
  it("maps primary to confirm (still the prompt's hud-btn-primary) and secondary to neutral", () => {
    expect(hudButtonClass("primary").split(" ")).toEqual(["hud-btn", "hud-btn-primary", "gb", "gb-confirm"]);
    expect(hudButtonClass().split(" ")).toEqual(["hud-btn", "gb", "gb-neutral"]);
  });

  it("passes the design's other roles through, with no primary marker", () => {
    expect(hudButtonClass("allow")).toBe("hud-btn gb gb-allow");
    expect(hudButtonClass("deny")).toBe("hud-btn gb gb-deny");
    expect(hudButtonClass("cancel", "sm")).toBe("hud-btn gb gb-cancel gb-sm");
  });
});
