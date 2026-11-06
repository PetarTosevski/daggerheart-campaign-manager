/**
 * The Combat HUD token (plan combat-hud H1.3; docs/tasks/TASK-HUD-H1.3.md): the anatomy (arcs with HP left and Stress
 * marked, Hope chip, condition badges, side colour), the accessible names ("n of 6 marked", user answer 2), what a
 * click opens, and hard rule 2: a player never gets an adversary arc or number.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { TokenView } from "../../../convex/combatTokens";
import { TokenFace, arcsOf, hopeByToken, otherFace, pcTokenFace, showsNumbers, toneOf } from "@/components/combat-map/hud/token";
import type { OtherToken } from "@/components/combat-map/vision/use-vision";
import { CONDITIONS } from "@/lib/validation/character-constants";

const tokenId = (s: string) => s as Id<"combatTokens">;

function token(over: Partial<TokenView> = {}): TokenView {
  return {
    _id: tokenId("tok-moss"),
    kind: "pc",
    characterId: "char-moss" as Id<"characters">,
    side: "pc",
    x: 5,
    y: 10,
    size: 1,
    face: 0,
    light: "none",
    name: "Moss",
    sub: "Druid · level 1",
    portrait: null,
    canMove: true,
    mine: true,
    stats: { hp: 2, hpMax: 6, stress: 3, stressMax: 6, conditions: ["vulnerable"], down: false },
    ...over,
  };
}

const lieutenant = (): TokenView =>
  token({
    _id: tokenId("tok-lt"),
    kind: "adversary",
    characterId: undefined,
    instanceId: "inst-lt" as Id<"encounterAdversaries">,
    side: "enemy",
    name: "Jagged Knife Lieutenant",
    sub: "Leader",
    mine: false,
    canMove: false,
    stats: { hp: 2, hpMax: 6, stress: 1, stressMax: 3, conditions: ["restrained"], difficulty: 13, down: false },
  });

function other(over: Partial<OtherToken> = {}): OtherToken {
  return { _id: tokenId("tok-bandit"), name: "Jagged Knife Bandit", side: "enemy", x: 10, y: 12, size: 1, face: Math.PI, revealed: false, ...over };
}

describe("token model", () => {
  it("colours each side: you gold, ally PC teal, ally NPC mint, neutral grey, adversary red", () => {
    expect(toneOf("pc", true)).toBe("you");
    expect(toneOf("pc", false)).toBe("ally-pc");
    expect(toneOf("ally", false)).toBe("ally");
    expect(toneOf("neutral", false)).toBe("neutral");
    expect(toneOf("enemy", false)).toBe("enemy");
  });

  it("arcs show HP left and Stress marked, in percent of each half", () => {
    expect(arcsOf({ marked: 2, max: 6 }, { marked: 3, max: 6 })).toEqual({ hpLeft: 67, stressMarked: 50 });
    expect(arcsOf({ marked: 6, max: 6 }, { marked: 0, max: 6 })).toEqual({ hpLeft: 0, stressMarked: 0 });
    expect(arcsOf({ marked: 0, max: 0 }, { marked: 0, max: 0 })).toBeNull();
  });

  it("only the GM sees numbers on non-PC tokens", () => {
    expect(showsNumbers("gm", "adversary")).toBe(true);
    expect(showsNumbers("gm", "pc")).toBe(true);
    expect(showsNumbers("player", "pc")).toBe(true);
    expect(showsNumbers("player", "adversary")).toBe(false);
    expect(showsNumbers("player", "custom")).toBe(false);
  });

  it("your own token names its actions (the ring, dcm-bxp.99.32.21), a PC token opens its sheet; HP and Stress as marked (answer 2), Hope and conditions", () => {
    const face = pcTokenFace(token(), "player", 1);
    expect(face.label).toBe("Moss (your character): actions, 2 of 6 Hit Points marked, 3 of 6 Stress marked, 1 Hope, Vulnerable");
    expect(face.sheet).toEqual({ kind: "pc", characterId: "char-moss" });
    expect(face.tone).toBe("you");
    expect(face.arcs).toEqual({ hpLeft: 67, stressMarked: 50 });
    expect(face.hope).toBe(1);
    expect(face.conditions).toEqual([{ id: "vulnerable", label: "Vulnerable" }]);
    const ally = pcTokenFace(token({ name: "Brannoc", mine: false }), "player", 3);
    expect(ally.label.startsWith("Open Brannoc’s sheet, ")).toBe(true);
    // The GM's click on Moss opens the sheet (no ring for the GM).
    expect(pcTokenFace(token({ mine: false }), "gm", 1).label.startsWith("Open Moss’s sheet, ")).toBe(true);
    expect(ally.tone).toBe("ally-pc");
  });

  it("a GM's adversary token opens its stat block and carries arcs", () => {
    const face = pcTokenFace(lieutenant(), "gm", null);
    expect(face.label).toBe("Open the Jagged Knife Lieutenant’s stat block, 2 of 6 Hit Points marked, 1 of 3 Stress marked, Restrained");
    expect(face.sheet).toEqual({ kind: "adversary", tokenId: "tok-lt" });
    expect(face.arcs).toEqual({ hpLeft: 67, stressMarked: 33 });
    expect(face.hope).toBeNull();
    expect(face.tone).toBe("enemy");
  });

  it("never gives a player an adversary arc, number or stat block, even from a stray stats object", () => {
    const face = pcTokenFace(lieutenant(), "player", 4);
    expect(face.arcs).toBeNull();
    expect(face.hope).toBeNull();
    expect(face.sheet).toBeNull();
    expect(face.label).not.toMatch(/\d/);
    expect(face.label).toBe("Jagged Knife Lieutenant, Enemy, Restrained");
  });

  it("a GM's custom ally or neutral token selects only and keeps its numbers", () => {
    const merchant = pcTokenFace(token({ kind: "custom", characterId: undefined, side: "neutral", name: "Merchant", mine: false }), "gm", null);
    expect(merchant.sheet).toBeNull();
    expect(merchant.tone).toBe("neutral");
    expect(merchant.label.startsWith("Merchant, Neutral, 2 of 6 Hit Points marked")).toBe(true);
  });

  it("a player's other token: side colour and condition names, never an arc or a number", () => {
    const face = otherFace(other({ conditions: [{ id: "vulnerable", label: "Vulnerable" }], revealed: true }), true);
    expect(face.label).toBe("Jagged Knife Bandit, Enemy, Vulnerable, revealed to you, your target");
    expect(face.arcs).toBeNull();
    expect(face.hope).toBeNull();
    expect(face.sheet).toBeNull();
    expect(otherFace(other({ side: "ally", name: "Guide" }), false).tone).toBe("ally");
    expect(otherFace(other(), false).label).toBe("Jagged Knife Bandit, Enemy");
  });

  it("reads each PC token's Hope from the party rows", () => {
    const hope = hopeByToken([{ tokenId: tokenId("a"), hope: { value: 2 } }]);
    expect(hope.get("a")).toBe(2);
    expect(hopeByToken(undefined).size).toBe(0);
  });
});

describe("TokenFace", () => {
  it("draws the board's anatomy: arcs with pathLength 100 and stroke-dasharray, the Hope chip, badges, the name", () => {
    const face = pcTokenFace(token({ stats: { hp: 2, hpMax: 6, stress: 3, stressMax: 6, conditions: ["vulnerable", "restrained"], down: false } }), "player", 1);
    const { container } = render(<TokenFace face={face} name="Moss" initials="M" size={48} />);
    const root = container.querySelector(".hud-tk-c");
    expect(root).toHaveClass("tk-you");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root?.getAttribute("style")).toContain("--s: 48px");
    const arc = container.querySelector("svg.tk-arc");
    expect(arc).not.toBeNull();
    const hp = arc?.querySelector("path.a-hp");
    const st = arc?.querySelector("path.a-st");
    expect(hp).toHaveAttribute("pathLength", "100");
    expect(hp).toHaveAttribute("stroke-dasharray", "67 100");
    expect(st).toHaveAttribute("pathLength", "100");
    expect(st).toHaveAttribute("stroke-dasharray", "50 100");
    expect(arc?.querySelectorAll("path.a-bg")).toHaveLength(2);
    expect(container.querySelector(".tk-hope")).toHaveTextContent("1");
    const badges = container.querySelectorAll(".tk-cd");
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveAttribute("title", "Vulnerable");
    expect(badges[1]).toHaveClass("tk-cd-restrained");
    expect(container.querySelector(".tk-name")).toHaveTextContent("Moss");
    expect(container.querySelector(".tk-ini")).toHaveTextContent("M");
  });

  it("a player's adversary face has no ring, no Hope and no number, only its condition badges", () => {
    const face = otherFace(other({ conditions: [{ id: "hidden", label: "Hidden" }] }), false);
    const { container } = render(<TokenFace face={face} name="Jagged Knife Bandit" initials="JB" size={48} />);
    expect(container.querySelector(".tk-arc")).toBeNull();
    expect(container.querySelector(".tk-hope")).toBeNull();
    expect(container.querySelector(".hud-tk-c")).toHaveClass("tk-enemy");
    expect(container.querySelector(".tk-cd")).toHaveAttribute("title", "Hidden");
    expect(container.textContent ?? "").not.toMatch(/\d/);
    const fromStats = pcTokenFace(lieutenant(), "player", 3);
    const again = render(<TokenFace face={fromStats} name="Jagged Knife Lieutenant" initials="JL" size={48} />);
    expect(again.container.querySelector(".tk-arc")).toBeNull();
    expect(again.container.textContent ?? "").not.toMatch(/\d/);
  });

  it("shows more than three conditions as +n, greys a downed token, and draws art when there is some", () => {
    const face = pcTokenFace(
      token({
        portrait: { kind: "url", url: "https://example.test/moss.png" },
        stats: { hp: 6, hpMax: 6, stress: 0, stressMax: 6, conditions: ["vulnerable", "restrained", "hidden", "distracted"], down: true },
      }),
      "gm",
      0,
    );
    const { container } = render(<TokenFace face={face} name="Moss" initials="M" size={48} />);
    expect(container.querySelector(".hud-tk-c")).toHaveClass("tk-down");
    expect(container.querySelector(".tk-cd-more")).toHaveTextContent("+1");
    expect(container.querySelector("img.tk-img")).not.toBeNull();
    expect(container.querySelector(".tk-ini")).toBeNull();
    expect(container.querySelector("path.a-hp")).toHaveAttribute("stroke-dasharray", "0 100");
    expect(face.label).toContain("down");
  });

  it("draws every condition as its own icon, never a letter, and keeps the condition name as the badge title (dcm-bxp.99.32.39)", () => {
    const shapes = new Set<string>();
    for (const id of CONDITIONS) {
      const face = otherFace(other({ conditions: [{ id, label: id[0].toUpperCase() + id.slice(1) }] }), false);
      const { container, unmount } = render(<TokenFace face={face} name="Moss" initials="M" size={48} />);
      const badge = container.querySelector(".tk-cd");
      expect(badge).toHaveAttribute("title", id[0].toUpperCase() + id.slice(1));
      expect(badge).toHaveAttribute("data-condition", id);
      const svg = badge?.querySelector("svg.ic");
      expect(svg, id).not.toBeNull();
      expect(badge?.textContent).toBe("");
      shapes.add(svg?.innerHTML ?? "");
      unmount();
    }
    expect(shapes.size).toBe(CONDITIONS.length);
  });
});
