import { assetBackground, designAsset } from "./design-assets";
import { CUSTOM_BACKGROUNDS, getPublishedFrame, type FrameId } from "./frames";

/**
 * Dashboard header art for a campaign: its frame's art, or the custom pick. `src` is the image path for `next/image`
 * (undefined when the asset is missing, so callers show the panel colour); `image` is the same art as a CSS
 * `background-image` value for callers not yet on `next/image` (CL10).
 */
export function campaignArt(frameId: FrameId, customBackground?: string) {
  const art =
    frameId === "custom"
      ? (CUSTOM_BACKGROUNDS.find((b) => b.id === customBackground) ?? CUSTOM_BACKGROUNDS[0]).art
      : getPublishedFrame(frameId)!.intro;
  return { src: designAsset(art.asset), image: assetBackground(art.asset), position: art.position };
}
