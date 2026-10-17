import { assetBackground } from "./design-assets";
import { CUSTOM_BACKGROUNDS, getPublishedFrame, type FrameId } from "./frames";

/** Dashboard header art for a campaign: its frame's art, or the custom pick. */
export function campaignArt(frameId: FrameId, customBackground?: string) {
  if (frameId === "custom") {
    const bg = CUSTOM_BACKGROUNDS.find((b) => b.id === customBackground) ?? CUSTOM_BACKGROUNDS[0];
    return { image: assetBackground(bg.art.asset), position: bg.art.position };
  }
  const frame = getPublishedFrame(frameId)!;
  return { image: assetBackground(frame.intro.asset), position: frame.intro.position };
}
