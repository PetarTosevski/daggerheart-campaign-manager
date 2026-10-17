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
