import { SkiaMapCanvas } from "./canvas/context";
import { loadSkia, type SkImage } from "./canvas/skia-runtime";
import { FOG_PX } from "./constants";
import { FOG_COLOURS, fogImage, type FogMasks } from "./fog-paint";
import { paintStats } from "./paint-stats";

/**
 * Squares of fog drawn past the map's edge. The website pads a player's fog by FOG_PAD_SQUARES (24) squares; past
 * the first two everything is plain unseen fog, which the screen fills as its background, so the fog image stays
 * small (a Large map: 44 x 31 squares at FOG_PX, about 1.3 MB) instead of covering the whole margin.
 */
export const FOG_MARGIN = 2;

/** The board's fog blur (`blur(FOG_PX * 0.45 px)` on the website's FOG_PX canvas). */
const BLUR_SIGMA = Math.round(FOG_PX * 0.45);

/** The unseen fog as a CSS colour (the screen's background around the map for a player). */
export const UNSEEN_COLOUR = `rgba(${FOG_COLOURS.unseen[0]}, ${FOG_COLOURS.unseen[1]}, ${FOG_COLOURS.unseen[2]}, ${FOG_COLOURS.unseen[3] / 255})`;

/** The fog over the map: a Skia image and its rectangle in squares (it starts FOG_MARGIN squares before the map). */
export type FogPicture = { image: SkImage; x: number; y: number; w: number; h: number };

/**
 * Builds a player's fog (R11) the way the website's vision layer paints it: the server's masks at sample resolution,
 * blurred onto a FOG_PX-per-square canvas, the margin refilled with exactly the unseen fog after the blur. Runs only
 * when the masks change, never per frame.
 */
export async function paintFog(masks: FogMasks, w: number, h: number): Promise<FogPicture> {
  const started = Date.now();
  const skia = await loadSkia();
  const pad = FOG_MARGIN;
  const width = (w + 2 * pad) * FOG_PX;
  const height = (h + 2 * pad) * FOG_PX;
  const samples = fogImage(masks, pad);
  const sampleCanvas = new SkiaMapCanvas(skia, samples.width, samples.height);
  sampleCanvas.context.putImageData({ width: samples.width, height: samples.height, data: samples.data }, 0, 0);
  const fog = new SkiaMapCanvas(skia, width, height);
  const ctx = fog.context;
  const u = FOG_PX / masks.scale;
  ctx.drawImageBlurred(sampleCanvas, 0, 0, samples.width * u, samples.height * u, BLUR_SIGMA);
  const p = pad * FOG_PX;
  ctx.fillStyle = UNSEEN_COLOUR;
  ctx.fillRect(0, 0, width, p);
  ctx.fillRect(0, height - p, width, p);
  ctx.fillRect(0, p, p, height - 2 * p);
  ctx.fillRect(width - p, p, p, height - 2 * p);
  paintStats.fog += 1;
  paintStats.lastFogMs = Date.now() - started;
  return { image: fog.snapshot(), x: -pad, y: -pad, w: w + 2 * pad, h: h + 2 * pad };
}
