import manifest from "./design-assets.generated.json";

const paths: Record<string, string> = manifest;

/**
 * Public URL of a design image, by the asset id the boards reference as
 * `/_blob/<id>`. Unknown ids return undefined, so callers fall back to the
 * panel colour as the boards do when art is missing.
 */
export function designAsset(id: string): string | undefined {
  return paths[id];
}

/** `background-image` value for an asset, or `none`. */
export function assetBackground(id: string): string {
  const path = designAsset(id);
  return path ? `url(${path})` : "none";
}
