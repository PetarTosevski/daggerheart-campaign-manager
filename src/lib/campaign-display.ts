import { getPublishedFrame, type FrameId } from "./frames";

export function frameName(frameId: FrameId): string {
  return frameId === "custom" ? "Custom frame" : (getPublishedFrame(frameId)?.name ?? frameId);
}

const ROMANS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function roman(index: number): string {
  return ROMANS[index] ?? String(index + 1);
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * A campaign card's role badge: the creator runs it ("Game Master"), a co-GM has role "gm" without being the creator
 * ("Co-GM", dcm-6dtb, user 2026-11-04), everyone else plays ("Player").
 */
export function campaignRoleLabel(campaign: { role: "gm" | "player"; isCreator: boolean }): "Game Master" | "Co-GM" | "Player" {
  if (campaign.role !== "gm") return "Player";
  return campaign.isCreator ? "Game Master" : "Co-GM";
}
