import {
  AlphaType,
  BlendMode,
  ClipOp,
  ColorType,
  FilterMode,
  MipmapMode,
  PaintStyle,
  StrokeCap,
  StrokeJoin,
  TileMode,
} from "./skia-enums";
import type { SkCanvas, SkImage, SkPaint, SkPath, SkPathBuilder, SkiaApi } from "./skia-runtime";

type LineCap = "butt" | "round" | "square";
type LineJoin = "miter" | "round" | "bevel";
type SmoothingQuality = "low" | "medium" | "high";
type FillStyle = string | SkiaGradient;

interface DrawState {
  fillStyle: FillStyle;
  strokeStyle: FillStyle;
  lineWidth: number;
  lineCap: LineCap;
  lineJoin: LineJoin;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  lineDash: number[];
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: SmoothingQuality;
}

interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const TAU = Math.PI * 2;

/**
 * A canvas 2D context backed by a Skia surface. The website painters in
 * `src/lib/combat-map` draw into this without knowing it is Skia.
 */
export class SkiaCanvasContext {
  fillStyle: FillStyle = "#000000";
  strokeStyle: FillStyle = "#000000";
  lineWidth = 1;
  lineCap: LineCap = "butt";
  lineJoin: LineJoin = "miter";
  shadowColor = "rgba(0, 0, 0, 0)";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  imageSmoothingEnabled = true;
  imageSmoothingQuality: SmoothingQuality = "low";

  private path: SkPathBuilder;
  private lineDash: number[] = [];
  private readonly stack: DrawState[] = [];

  constructor(
    private readonly skia: SkiaApi,
    private readonly canvas: SkCanvas,
    readonly width: number,
    readonly height: number,
  ) {
    this.path = skia.PathBuilder.Make();
    this.canvas.clear(skia.Color("rgba(0,0,0,0)"));
  }

  save(): void {
    this.stack.push(this.capture());
    this.canvas.save();
  }

  restore(): void {
    const previous = this.stack.pop();
    if (previous) this.applyState(previous);
    this.canvas.restore();
  }

  beginPath(): void {
    this.path = this.skia.PathBuilder.Make();
  }

  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    if (this.path.isEmpty()) this.path.moveTo(x, y);
    else this.path.lineTo(x, y);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (this.path.isEmpty()) this.path.moveTo(x, y);
    else this.path.quadTo(cpx, cpy, x, y);
  }

  closePath(): void {
    this.path.close();
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path.addRect(this.skia.XYWHRect(x, y, w, h));
  }

  roundRect(x: number, y: number, w: number, h: number, radii: number | readonly number[] = 0): void {
    const radius = typeof radii === "number" ? radii : (radii[0] ?? 0);
    this.path.addRRect(this.skia.RRectXY(this.skia.XYWHRect(x, y, w, h), radius, radius));
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.ellipse(x, y, radius, radius, 0, startAngle, endAngle, counterclockwise);
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    const sweep = arcSweep(startAngle, endAngle, counterclockwise);
    const local = this.skia.PathBuilder.Make();
    const oval = this.skia.XYWHRect(-radiusX, -radiusY, radiusX * 2, radiusY * 2);
    if (Math.abs(sweep) >= TAU - 1e-4) local.addOval(oval);
    else local.arcToOval(oval, (startAngle * 180) / Math.PI, (sweep * 180) / Math.PI, true);
    const matrix = this.skia.Matrix();
    matrix.translate(x, y);
    matrix.rotate(rotation);
    local.transform(matrix);
    this.path.addPath(local.build());
  }

  clip(): void {
    const path = this.builtPath();
    if (!path) return;
    this.canvas.clipPath(path, ClipOp.Intersect, true);
  }

  fill(): void {
    const path = this.builtPath();
    if (!path) return;
    this.paint((target) => target.drawPath(path, this.fillPaint()));
  }

  stroke(): void {
    const path = this.builtPath();
    if (!path) return;
    this.paint((target) => target.drawPath(path, this.strokePaint()));
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (w === 0 || h === 0) return;
    const rect = this.skia.XYWHRect(x, y, w, h);
    this.paint((target) => target.drawRect(rect, this.fillPaint()));
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    if (w === 0 || h === 0) return;
    const rect = this.skia.XYWHRect(x, y, w, h);
    this.paint((target) => target.drawRect(rect, this.strokePaint()));
  }

  translate(x: number, y: number): void {
    this.canvas.translate(x, y);
  }

  rotate(radians: number): void {
    this.canvas.rotate((radians * 180) / Math.PI, 0, 0);
  }

  setLineDash(segments: ArrayLike<number>): void {
    const dash = Array.from(segments, Number);
    this.lineDash = dash.length % 2 === 1 ? dash.concat(dash) : dash;
  }

  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): SkiaGradient {
    return new SkiaGradient(x0, y0, r0, x1, y1, r1);
  }

  createImageData(width: number, height: number): PixelBuffer {
    const w = Math.max(0, Math.floor(width));
    const h = Math.max(0, Math.floor(height));
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  putImageData(image: PixelBuffer, dx: number, dy: number): void {
    if (image.width <= 0 || image.height <= 0) return;
    const bytes = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    const data = this.skia.Data.fromBytes(bytes);
    const bitmap = this.skia.Image.MakeImage(
      {
        width: image.width,
        height: image.height,
        alphaType: AlphaType.Unpremul,
        colorType: ColorType.RGBA_8888,
      },
      data,
      image.width * 4,
    );
    if (!bitmap) throw new Error("Skia could not build an image from pixel data");
    const paint = this.skia.Paint();
    paint.setAntiAlias(false);
    paint.setBlendMode(BlendMode.Src);
    this.canvas.save();
    this.useDeviceSpace();
    this.canvas.drawImageRectOptions(
      bitmap,
      this.skia.XYWHRect(0, 0, image.width, image.height),
      this.skia.XYWHRect(dx, dy, image.width, image.height),
      FilterMode.Nearest,
      MipmapMode.None,
      paint,
    );
    this.canvas.restore();
  }

  /** Draws a decoded image across this whole surface. */
  blitImage(image: SkImage): void {
    const paint = this.skia.Paint();
    paint.setAntiAlias(true);
    this.canvas.save();
    this.useDeviceSpace();
    this.canvas.drawImageRectOptions(
      image,
      this.skia.XYWHRect(0, 0, image.width(), image.height()),
      this.skia.XYWHRect(0, 0, this.width, this.height),
      FilterMode.Linear,
      MipmapMode.None,
      paint,
    );
    this.canvas.restore();
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): PixelBuffer {
    const width = Math.max(0, Math.floor(sw));
    const height = Math.max(0, Math.floor(sh));
    const data = new Uint8ClampedArray(width * height * 4);
    if (width === 0 || height === 0) return { width, height, data };
    const raw = this.canvas.readPixels(sx, sy, {
      width,
      height,
      alphaType: AlphaType.Unpremul,
      colorType: ColorType.RGBA_8888,
    });
    if (!raw) throw new Error("Skia could not read pixels");
    data.set(raw.subarray(0, data.length));
    return { width, height, data };
  }

  drawImage(source: SkiaMapCanvas, dx: number, dy: number): void;
  drawImage(source: SkiaMapCanvas, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(
    source: SkiaMapCanvas,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  drawImage(source: SkiaMapCanvas, ...args: number[]): void {
    if (!(source instanceof SkiaMapCanvas)) {
      throw new Error("drawImage source is not a Skia surface");
    }
    const image = source.snapshot();
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    let dx = 0;
    let dy = 0;
    let dw = source.width;
    let dh = source.height;
    if (args.length === 2) {
      dx = args[0] ?? 0;
      dy = args[1] ?? 0;
    } else if (args.length === 4) {
      dx = args[0] ?? 0;
      dy = args[1] ?? 0;
      dw = args[2] ?? 0;
      dh = args[3] ?? 0;
    } else if (args.length === 8) {
      sx = args[0] ?? 0;
      sy = args[1] ?? 0;
      sw = args[2] ?? 0;
      sh = args[3] ?? 0;
      dx = args[4] ?? 0;
      dy = args[5] ?? 0;
      dw = args[6] ?? 0;
      dh = args[7] ?? 0;
    } else {
      throw new Error(`drawImage does not implement ${args.length} numeric arguments`);
    }
    if (sw === 0 || sh === 0 || dw === 0 || dh === 0) return;
    const src = this.skia.XYWHRect(sx, sy, sw, sh);
    const dest = this.skia.XYWHRect(dx, dy, dw, dh);
    const filter = this.imageSmoothingEnabled ? FilterMode.Linear : FilterMode.Nearest;
    this.paint((target) => {
      const paint = this.skia.Paint();
      paint.setAntiAlias(this.imageSmoothingEnabled);
      target.drawImageRectOptions(image, src, dest, filter, MipmapMode.None, paint);
    });
  }

  /**
   * `drawImage` through a Gaussian blur of `sigma` device pixels (canvas `filter = "blur(<sigma>px)"`), for the fog's
   * soft edge. Drawn in device space at the given rectangle.
   */
  drawImageBlurred(source: SkiaMapCanvas, dx: number, dy: number, dw: number, dh: number, sigma: number): void {
    if (dw === 0 || dh === 0) return;
    const image = source.snapshot();
    const paint = this.skia.Paint();
    paint.setAntiAlias(true);
    if (sigma > 0) paint.setImageFilter(this.skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Clamp, null, null));
    this.canvas.drawImageRectOptions(
      image,
      this.skia.XYWHRect(0, 0, source.width, source.height),
      this.skia.XYWHRect(dx, dy, dw, dh),
      FilterMode.Linear,
      MipmapMode.None,
      paint,
    );
  }

  readPixels(): Uint8ClampedArray {
    const pixels = this.getImageData(0, 0, this.width, this.height);
    return pixels.data;
  }

  private builtPath(): SkPath | null {
    if (this.path.isEmpty()) return null;
    return this.path.build();
  }

  private fillPaint(): SkPaint {
    const paint = this.skia.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(PaintStyle.Fill);
    this.applyStyle(paint, this.fillStyle);
    return paint;
  }

  private strokePaint(): SkPaint {
    const paint = this.skia.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(this.lineWidth);
    paint.setStrokeCap(STROKE_CAP[this.lineCap]);
    paint.setStrokeJoin(STROKE_JOIN[this.lineJoin]);
    if (this.lineDash.length > 0) paint.setPathEffect(this.skia.PathEffect.MakeDash(this.lineDash, 0));
    this.applyStyle(paint, this.strokeStyle);
    return paint;
  }

  private applyStyle(paint: SkPaint, style: FillStyle): void {
    if (typeof style === "string") {
      paint.setColor(this.skia.Color(style));
      return;
    }
    const stops = [...style.stops].sort((a, b) => a.offset - b.offset);
    if (stops.length === 0) {
      paint.setColor(this.skia.Color("rgba(0,0,0,0)"));
      return;
    }
    paint.setShader(
      this.skia.Shader.MakeTwoPointConicalGradient(
        { x: style.x0, y: style.y0 },
        style.r0,
        { x: style.x1, y: style.y1 },
        style.r1,
        stops.map((stop) => this.skia.Color(stop.color)),
        stops.map((stop) => stop.offset),
        TileMode.Clamp,
      ),
    );
  }

  /**
   * Canvas shadows are in device space. Record the draw with the current
   * transform baked in, offset and blur that picture, then draw the shape itself.
   */
  private paint(draw: (target: SkCanvas) => void): void {
    if (!this.shadowOn()) {
      draw(this.canvas);
      return;
    }
    const dx = this.shadowOffsetX;
    const dy = this.shadowOffsetY;
    const blur = this.shadowBlur;
    const sigma = Math.max(blur / 2, 0);
    const pad = Math.ceil(Math.abs(dx) + Math.abs(dy) + blur * 4 + Math.max(this.width, this.height) + 64);
    const bounds = this.skia.XYWHRect(-pad, -pad, this.width + pad * 2, this.height + pad * 2);
    // The offscreen layer only needs the surface plus the shadow's reach (offset and 3 sigma): anything further out
    // casts no shadow onto the surface. A layer three surfaces wide per shadowed object was the sprite paint's main
    // cost on a phone (dcm-gdzi.14). The recording keeps the wide cull rect; recording allocates no pixels.
    const reach = Math.ceil(Math.abs(dx) + Math.abs(dy) + sigma * 3 + 2);
    const layerBounds = this.skia.XYWHRect(-reach, -reach, this.width + reach * 2, this.height + reach * 2);
    const recorder = this.skia.PictureRecorder();
    const recording = recorder.beginRecording(bounds);
    recording.concat(this.canvas.getTotalMatrix().get());
    draw(recording);
    const picture = recorder.finishRecordingAsPicture();
    const filter = this.skia.ImageFilter.MakeDropShadowOnly(
      dx,
      dy,
      sigma,
      sigma,
      this.skia.Color(this.shadowColor),
      null,
      null,
    );
    const layer = this.skia.Paint();
    layer.setImageFilter(filter);
    this.canvas.save();
    this.useDeviceSpace();
    this.canvas.saveLayer(layer, layerBounds);
    this.canvas.drawPicture(picture);
    this.canvas.restore();
    this.canvas.restore();
    draw(this.canvas);
  }

  private shadowOn(): boolean {
    if (this.shadowBlur === 0 && this.shadowOffsetX === 0 && this.shadowOffsetY === 0) return false;
    return (this.skia.Color(this.shadowColor)[3] ?? 0) > 0;
  }

  /** Premultiply by the inverse of the current matrix so the next draw is in device pixels. */
  private useDeviceSpace(): void {
    const current = this.canvas.getTotalMatrix().get();
    if (isIdentity(current)) return;
    const inverse = invertAffine(current);
    if (!inverse) throw new Error("Skia transform cannot be inverted");
    this.canvas.concat(inverse);
  }

  private capture(): DrawState {
    return {
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      shadowColor: this.shadowColor,
      shadowBlur: this.shadowBlur,
      shadowOffsetX: this.shadowOffsetX,
      shadowOffsetY: this.shadowOffsetY,
      lineDash: this.lineDash.slice(),
      imageSmoothingEnabled: this.imageSmoothingEnabled,
      imageSmoothingQuality: this.imageSmoothingQuality,
    };
  }

  private applyState(state: DrawState): void {
    this.fillStyle = state.fillStyle;
    this.strokeStyle = state.strokeStyle;
    this.lineWidth = state.lineWidth;
    this.lineCap = state.lineCap;
    this.lineJoin = state.lineJoin;
    this.shadowColor = state.shadowColor;
    this.shadowBlur = state.shadowBlur;
    this.shadowOffsetX = state.shadowOffsetX;
    this.shadowOffsetY = state.shadowOffsetY;
    this.lineDash = state.lineDash;
    this.imageSmoothingEnabled = state.imageSmoothingEnabled;
    this.imageSmoothingQuality = state.imageSmoothingQuality;
  }
}

export class SkiaGradient {
  readonly stops: { offset: number; color: string }[] = [];

  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly r0: number,
    readonly x1: number,
    readonly y1: number,
    readonly r1: number,
  ) {}

  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}

/** A surface the painters can use as a `CanvasImageSource` (`drawImage` snapshots it). */
export class SkiaMapCanvas {
  readonly context: SkiaCanvasContext;
  private readonly surface: NonNullable<ReturnType<SkiaApi["Surface"]["Make"]>>;

  constructor(
    skia: SkiaApi,
    readonly width: number,
    readonly height: number,
  ) {
    if (width <= 0 || height <= 0) throw new Error(`Skia surface size must be positive (${width} x ${height})`);
    const surface = skia.Surface.Make(Math.ceil(width), Math.ceil(height));
    if (!surface) throw new Error("Skia could not allocate a surface");
    this.surface = surface;
    this.context = new SkiaCanvasContext(skia, surface.getCanvas(), Math.ceil(width), Math.ceil(height));
  }

  getContext(kind: "2d", _settings?: { willReadFrequently?: boolean }): SkiaCanvasContext | null {
    return kind === "2d" ? this.context : null;
  }

  snapshot(): SkImage {
    return this.surface.makeImageSnapshot();
  }
}

const STROKE_CAP: Record<LineCap, number> = {
  butt: StrokeCap.Butt,
  round: StrokeCap.Round,
  square: StrokeCap.Square,
};

const STROKE_JOIN: Record<LineJoin, number> = {
  miter: StrokeJoin.Miter,
  round: StrokeJoin.Round,
  bevel: StrokeJoin.Bevel,
};

function arcSweep(start: number, end: number, counterclockwise: boolean): number {
  if (!counterclockwise) {
    if (end - start >= TAU) return TAU;
    const sweep = (end - start) % TAU;
    return sweep < 0 ? sweep + TAU : sweep;
  }
  if (start - end >= TAU) return -TAU;
  const sweep = (end - start) % TAU;
  return sweep > 0 ? sweep - TAU : sweep;
}

function isIdentity(matrix: readonly number[]): boolean {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return identity.every((value, index) => Math.abs((matrix[index] ?? 0) - value) < 1e-4);
}

/** Inverse of a 3x3 row-major affine matrix (`[a, b, c, d, e, f, 0, 0, 1]`). */
function invertAffine(matrix: readonly number[]): number[] | null {
  const a = matrix[0] ?? 0;
  const b = matrix[1] ?? 0;
  const c = matrix[2] ?? 0;
  const d = matrix[3] ?? 0;
  const e = matrix[4] ?? 0;
  const f = matrix[5] ?? 0;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-8) return null;
  return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det, 0, 0, 1];
}
