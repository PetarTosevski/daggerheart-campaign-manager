import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeJpegWithin, JPEG_QUALITIES, PORTRAIT_MAX_SIDE, shrinkPortrait } from "@/components/party/portrait";

const MB = 1024 * 1024;
/** The server's `MAX_PORTRAIT_BYTES` (convex/characters.ts). */
const SERVER_CAP = 3 * MB;

/** Every encode: the canvas size and the quality asked for. */
let encodes: { width: number; height: number; quality: number | undefined }[] = [];
/** The blob size each quality yields (default: a small file). */
let sizeAt: (quality: number) => number = () => 500_000;

beforeEach(() => {
  encodes = [];
  sizeAt = () => 500_000;
  // jsdom has no image decoding or canvas: a 4000 x 3000 photo is stubbed, and toBlob reports a size per quality.
  vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close: () => undefined }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
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

describe("portrait upload size (sharp-4k HD4)", () => {
  it("keeps 2048 px on the long side: a 4000 x 3000 photo becomes 2048 x 1536 at JPEG 0.86", async () => {
    expect(PORTRAIT_MAX_SIDE).toBe(2048);
    const blob = await shrinkPortrait(new File(["x"], "me.jpg", { type: "image/jpeg" }));
    expect(encodes).toEqual([{ width: 2048, height: 1536, quality: 0.86 }]);
    expect(blob.size).toBeLessThanOrEqual(SERVER_CAP);
  });

  it("steps the quality down until a noisy photo fits the 3 MB cap", async () => {
    sizeAt = (q) => ({ 0.86: 3.4 * MB, 0.8: 3.05 * MB, 0.72: 2.6 * MB, 0.6: 2.1 * MB })[q] ?? 0;
    const blob = await shrinkPortrait(new File(["x"], "noise.png", { type: "image/png" }));
    expect(encodes.map((e) => e.quality)).toEqual([0.86, 0.8, 0.72]);
    expect(encodes.every((e) => e.width === 2048 && e.height === 1536)).toBe(true);
    expect(blob.size).toBe(2.6 * MB);
  });

  it("returns the smallest try when nothing fits, for the server to turn down", async () => {
    sizeAt = () => 4 * MB;
    const canvas = document.createElement("canvas");
    const blob = await encodeJpegWithin(canvas, SERVER_CAP);
    expect(encodes.map((e) => e.quality)).toEqual([...JPEG_QUALITIES]);
    expect(blob.size).toBe(4 * MB);
  });

  it("leaves a small picture at its own size", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 800, height: 600, close: () => undefined }));
    await shrinkPortrait(new File(["x"], "small.jpg", { type: "image/jpeg" }));
    expect(encodes).toEqual([{ width: 800, height: 600, quality: 0.86 }]);
  });
});
