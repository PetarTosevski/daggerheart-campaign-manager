import { designAsset } from "../../../../../src/lib/design-assets";
import { WORLD_MAPS, type PlayerMapState } from "../../../../../src/lib/world/map-state";

/** Frame art URL, or the uploaded map URL when the campaign uses a custom image. */
export function resolveMapImageUrl(
  frameId: string,
  mapUrl: string | null,
  customMap: PlayerMapState["customMap"],
): string | null {
  if (customMap) return mapUrl;
  const published = (WORLD_MAPS as Record<string, { asset: string }>)[frameId];
  if (!published) return null;
  return designAsset(published.asset) ?? null;
}
