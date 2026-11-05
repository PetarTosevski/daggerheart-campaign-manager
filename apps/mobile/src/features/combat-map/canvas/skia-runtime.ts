import { createRequire } from "node:module";

export interface SkRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SkDisposable {
  dispose(): void;
}

export interface SkPaint extends SkDisposable {
  setAntiAlias(value: boolean): void;
  setColor(color: Float32Array): void;
  setStyle(style: number): void;
  setStrokeWidth(width: number): void;
  setStrokeCap(cap: number): void;
  setStrokeJoin(join: number): void;
  setPathEffect(effect: SkDisposable | null): void;
  setShader(shader: SkDisposable | null): void;
  setBlendMode(mode: number): void;
  setImageFilter(filter: SkDisposable | null): void;
}

export type SkPath = SkDisposable;

export interface SkPathBuilder {
  moveTo(x: number, y: number): SkPathBuilder;
  lineTo(x: number, y: number): SkPathBuilder;
  quadTo(cpx: number, cpy: number, x: number, y: number): SkPathBuilder;
  close(): SkPathBuilder;
  addRect(rect: SkRect): SkPathBuilder;
  addOval(oval: SkRect): SkPathBuilder;
  addRRect(rrect: unknown): SkPathBuilder;
  arcToOval(oval: SkRect, startDegrees: number, sweepDegrees: number, forceMoveTo: boolean): SkPathBuilder;
  transform(matrix: SkMatrix): SkPathBuilder;
  addPath(path: SkPath): SkPathBuilder;
  isEmpty(): boolean;
  build(): SkPath;
}

export interface SkMatrix {
  translate(x: number, y: number): SkMatrix;
  rotate(radians: number): SkMatrix;
  get(): number[];
}

export interface SkImageInfo {
  width: number;
  height: number;
  alphaType: number;
  colorType: number;
}

export interface SkImage extends SkDisposable {
  width(): number;
  height(): number;
}

export type SkPicture = SkDisposable;

export interface SkCanvas {
  save(): number;
  restore(): void;
  saveLayer(paint?: SkPaint | null, bounds?: SkRect | null): number;
  translate(dx: number, dy: number): void;
  rotate(degrees: number, rx: number, ry: number): void;
  concat(matrix: number[] | SkMatrix): void;
  clipPath(path: SkPath, op: number, antiAlias: boolean): void;
  drawPath(path: SkPath, paint: SkPaint): void;
  drawRect(rect: SkRect, paint: SkPaint): void;
  drawImageRectOptions(
    image: SkImage,
    src: SkRect,
    dest: SkRect,
    filter: number,
    mipmap: number,
    paint: SkPaint,
  ): void;
  drawPicture(picture: SkPicture): void;
  readPixels(x: number, y: number, info: SkImageInfo): Uint8Array | Float32Array | null;
  getTotalMatrix(): SkMatrix;
  clear(color: Float32Array): void;
}

export interface SkSurface {
  getCanvas(): SkCanvas;
  makeImageSnapshot(): SkImage;
}

export interface SkPictureRecorder {
  beginRecording(bounds?: SkRect): SkCanvas;
  finishRecordingAsPicture(): SkPicture;
}

export type SkData = SkDisposable;

export interface SkiaApi {
  Color(color: string | number[]): Float32Array;
  Paint(): SkPaint;
  PathBuilder: { Make(): SkPathBuilder };
  Matrix(): SkMatrix;
  Surface: { Make(width: number, height: number): SkSurface | null };
  XYWHRect(x: number, y: number, width: number, height: number): SkRect;
  RRectXY(rect: SkRect, rx: number, ry: number): unknown;
  Image: {
    MakeImage(info: SkImageInfo, data: SkData, bytesPerRow: number): SkImage | null;
    MakeImageFromEncoded(encoded: SkData): SkImage | null;
  };
  Data: { fromBytes(bytes: Uint8Array): SkData };
  Shader: {
    MakeTwoPointConicalGradient(
      start: { x: number; y: number },
      startRadius: number,
      end: { x: number; y: number },
      endRadius: number,
      colors: Float32Array[],
      positions: number[] | null,
      mode: number,
    ): SkDisposable;
  };
  PathEffect: { MakeDash(intervals: number[], phase?: number): SkDisposable };
  ImageFilter: {
    MakeDropShadowOnly(
      dx: number,
      dy: number,
      sigmaX: number,
      sigmaY: number,
      color: Float32Array,
      input: null,
      crop: null,
    ): SkDisposable;
  };
  PictureRecorder(): SkPictureRecorder;
}

interface NodeRequire {
  (id: string): unknown;
  resolve(id: string): string;
}

type CanvasKitInit = (opts?: object) => Promise<unknown>;

const globalSkia = globalThis as { SkiaApi?: SkiaApi };

let canvasKitSkia: Promise<SkiaApi> | null = null;

function nodeRequire(): NodeRequire {
  return createRequire(__filename) as NodeRequire;
}

/**
 * The Skia factory the adapter draws with. On device this is the native
 * `SkiaApi` installed by `@shopify/react-native-skia`. In Node tests it is
 * the same factory built on CanvasKit, which that package already depends on.
 */
function nativeSkia(): SkiaApi | null {
  if (process.env.JEST_WORKER_ID !== undefined) return null;
  const loaded = require("@shopify/react-native-skia") as { Skia?: SkiaApi };
  const skia = loaded.Skia;
  if (typeof skia !== "object" || skia === null || !("Paint" in skia) || !("Surface" in skia)) return null;
  return skia;
}

export function loadSkia(): Promise<SkiaApi> {
  if (globalSkia.SkiaApi) return Promise.resolve(globalSkia.SkiaApi);
  const onDevice = nativeSkia();
  if (onDevice) return Promise.resolve(onDevice);
  canvasKitSkia ??= loadCanvasKit();
  return canvasKitSkia;
}

async function loadCanvasKit(): Promise<SkiaApi> {
  const fromSkia = nodeRequire();
  const skiaRequire = createRequire(fromSkia.resolve("@shopify/react-native-skia/package.json")) as NodeRequire;
  const init = canvasKitInit(skiaRequire("canvaskit-wasm/bin/full/canvaskit"));
  const canvasKit = await init();
  const bindings = skiaRequire("./lib/commonjs/skia/web/JsiSkia.js") as {
    JsiSkApi: (kit: unknown) => SkiaApi;
  };
  return bindings.JsiSkApi(canvasKit);
}

function canvasKitInit(loaded: unknown): CanvasKitInit {
  if (typeof loaded === "function") return loaded as CanvasKitInit;
  if (loaded && typeof loaded === "object" && "default" in loaded && typeof loaded.default === "function") {
    return loaded.default as CanvasKitInit;
  }
  throw new Error("CanvasKit did not export a loader");
}
