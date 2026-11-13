// The Combat Map's paint worker (plan sharp-4k HD5): the Classic full repaint (painter.ts paintMap) off the main thread.
// map-canvas.tsx posts a PaintRequest through paint-worker-client.ts; the worker paints into an OffscreenCanvas of
// the map's backing-store size and posts the picture back as a transferred ImageBitmap (PaintResponse). The worker
// runs the same painter code as the main thread, so the pixels are the same.
//
// Loaded as a module worker: `new Worker(new URL("./paint-worker.ts", import.meta.url), { type: "module" })`.

import { mapPixelSize, paintMap, type PaintContext } from "./painter";
import type { PaintSpec, PaintedTerrain } from "./raster";

/** One full repaint: the map at `cell` backing-store pixels per square, with its hand-painted terrain. */
export interface PaintJob {
  readonly spec: PaintSpec;
  readonly paint: PaintedTerrain;
  readonly cell: number;
}

export interface PaintRequest extends PaintJob {
  /** The client's request number; the response carries it back. */
  readonly id: number;
}

/** The painted map (transferred), or why it could not be painted. */
export type PaintResponse = { readonly id: number; readonly bitmap: ImageBitmap } | { readonly id: number; readonly error: string };

/** The part of an OffscreenCanvas the worker uses (tests pass a recording one). */
export interface BitmapCanvas {
  getContext(type: "2d"): PaintContext | null;
  transferToImageBitmap(): ImageBitmap;
}

/** Paints `job` on a fresh canvas from `makeCanvas` and returns its picture. */
export function paintBitmap(job: PaintJob, makeCanvas: (width: number, height: number) => BitmapCanvas): ImageBitmap {
  const { width, height } = mapPixelSize(job.spec, job.cell);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context on the OffscreenCanvas.");
  paintMap(ctx, job.spec, { cell: job.cell, paint: job.paint });
  return canvas.transferToImageBitmap();
}

/** The worker's message handler: one request in, one response out. */
export function handleRequest(request: PaintRequest, post: (response: PaintResponse, transfer: Transferable[]) => void): void {
  let bitmap: ImageBitmap;
  try {
    bitmap = paintBitmap(request, (width, height) => new OffscreenCanvas(width, height) as BitmapCanvas);
  } catch (error) {
    post({ id: request.id, error: error instanceof Error ? error.message : String(error) }, []);
    return;
  }
  post({ id: request.id, bitmap }, [bitmap]);
}

// Inside a worker only (importing this module on the page, or in a test, registers nothing).
declare const WorkerGlobalScope: (new () => object) | undefined;
if (typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof WorkerGlobalScope) {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<PaintRequest>) => void) | null;
    postMessage(message: PaintResponse, transfer: Transferable[]): void;
  };
  scope.onmessage = (event) => handleRequest(event.data, (response, transfer) => scope.postMessage(response, transfer));
}
