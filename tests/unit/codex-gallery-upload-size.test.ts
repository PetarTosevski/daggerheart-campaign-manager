import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CODEX_IMAGE_MAX_SIDE, shrinkCodexImage } from "@/app/(gm)/campaigns/[campaignId]/codex/gallery";
import { MAX_CODEX_IMAGE_BYTES } from "@/lib/codex/schema";

const MB = 1024 * 1024;

/** Every encode: the canvas size and the quality asked for. */
let encodes: { width: number; height: number; quality: number | undefined }[] = [];
let sizeAt: (quality: number) => number = () => 1_500_000;
let bitmap = { width: 4000, height: 3000 };

beforeEach(() => {
  encodes = [];
  sizeAt = () => 1_500_000;
  bitmap = { width: 4000, height: 3000 };
  // jsdom has no image decoding or canvas: the photo is stubbed, and toBlob reports a size per quality.
  vi.stubGlobal("createImageBitmap", async () => ({ ...bitmap, close: () => undefined }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: () => undefined,
    fillRect: () => undefined,
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, done, type, quality) {
    const q = quality as number;
    encodes.push({ width: this.width, height: this.height, quality: q });
    expect(type).toBe("image/jpeg");
    done({ size: sizeAt(q), type: "image/jpeg" } as Blob);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Codex image upload size (sharp-4k HD4)", () => {
  it("keeps 2560 px on the long side: a 4000 x 3000 photo becomes 2560 x 1920 at JPEG 0.86", async () => {
    expect(CODEX_IMAGE_MAX_SIDE).toBe(2560);
    const blob = await shrinkCodexImage(new File(["x"], "map.jpg", { type: "image/jpeg" }));
    expect(encodes).toEqual([{ width: 2560, height: 1920, quality: 0.86 }]);
    expect(blob.size).toBeLessThanOrEqual(MAX_CODEX_IMAGE_BYTES);
  });

  it("shrinks a tall image by its height", async () => {
    bitmap = { width: 3000, height: 4000 };
    await shrinkCodexImage(new File(["x"], "tall.jpg", { type: "image/jpeg" }));
    expect(encodes[0]).toMatchObject({ width: 1920, height: 2560 });
  });

  it("steps the quality down until a noisy photo fits the server cap", async () => {
    expect(MAX_CODEX_IMAGE_BYTES).toBe(3 * MB);
    // Sizes measured with libjpeg-turbo for per-pixel RGB noise at 2560 x 1920 (the worst case).
    sizeAt = (q) => ({ 0.86: 3.43 * MB, 0.8: 2.97 * MB, 0.72: 2.55 * MB, 0.6: 2.08 * MB })[q] ?? 0;
    const blob = await shrinkCodexImage(new File(["x"], "noise.png", { type: "image/png" }));
    expect(encodes.map((e) => e.quality)).toEqual([0.86, 0.8]);
    expect(blob.size).toBeLessThanOrEqual(MAX_CODEX_IMAGE_BYTES);
  });
});
