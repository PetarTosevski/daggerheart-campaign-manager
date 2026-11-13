import { afterEach, describe, expect, it, vi } from "vitest";

import { generateFallbackLayout } from "../../src/lib/combat-map/fallback-layout";
import { handleRequest, type PaintRequest, type PaintResponse } from "../../src/lib/combat-map/paint-worker";
import { PaintWorkerClient, type PaintCallbacks, type PaintPort } from "../../src/lib/combat-map/paint-worker-client";
import { mapPixelSize, paintMap } from "../../src/lib/combat-map/painter";
import type { PaintSpec, PaintedTerrain } from "../../src/lib/combat-map/raster";

// Plan sharp-4k HD5: the Classic full repaint runs in a module worker (paint-worker.ts) and comes back as an
// ImageBitmap; the client (paint-worker-client.ts) lets only the newest request's picture through.

// ---------------------------------------------------------------------------------------------------- recording context
// jsdom has no canvas: a context that records every call (in order, with its arguments) and every putImageData's pixels.
// Two paints with the same record draw the same pixels.

type Recording = { calls: string[]; pixels: string[] };

function recordingContext(): { ctx: CanvasRenderingContext2D; recording: Recording } {
  const recording: Recording = { calls: [], pixels: [] };
  const record = (op: string, args: unknown[]) => recording.calls.push(`${op} ${JSON.stringify(args)}`);
  const special: Record<string, (...a: unknown[]) => unknown> = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray((w as number) * (h as number) * 4) }),
    putImageData: (img, x, y) => {
      const { data, width, height } = img as ImageData;
      let hash = 0;
      for (let i = 0; i < data.length; i++) hash = (Math.imul(hash, 31) + data[i]!) | 0;
      recording.pixels.push(`${width}x${height}@${String(x)},${String(y)}:${hash}`);
    },
    createRadialGradient: () => ({ addColorStop: (...a: unknown[]) => record("addColorStop", a) }),
    createLinearGradient: () => ({ addColorStop: (...a: unknown[]) => record("addColorStop", a) }),
  };
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        record(prop, args);
        return special[prop]?.(...args);
      };
    },
    set(target, prop, value) {
      target[prop as string] = value;
      record(`set:${String(prop)}`, [typeof value === "object" ? "gradient" : value]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, recording };
}

/** A fake ImageBitmap that remembers whether it was closed. */
type FakeBitmap = ImageBitmap & { closed: boolean; recording?: Recording };
const fakeBitmap = (width = 1, height = 1, recording?: Recording): FakeBitmap => {
  const bitmap = { width, height, closed: false, recording, close: () => void (bitmap.closed = true) };
  return bitmap as FakeBitmap;
};

/** The worker's OffscreenCanvas in jsdom: a recording context, and its record as the "bitmap". */
class RecordingOffscreenCanvas {
  readonly made = recordingContext();
  constructor(readonly width: number, readonly height: number) {}
  getContext() {
    return this.made.ctx;
  }
  transferToImageBitmap() {
    return fakeBitmap(this.width, this.height, this.made.recording);
  }
}

afterEach(() => vi.unstubAllGlobals());

const spec = (): PaintSpec => {
  const layout = generateFallbackLayout("A bandit camp by a river with a stone bridge, tents, a campfire and lava", { seed: 11, w: 14, h: 10 });
  return { w: layout.w, h: layout.h, seed: layout.seed, base: layout.base, plankV: layout.plankV, areas: layout.areas, objects: layout.objects };
};
const painted: PaintedTerrain = { "1,1": "wall", "2,1": "wall", "5,6": "water", "6,6": "deep", "9,2": "stone" };

describe("paint worker: same pixels as the main thread", () => {
  for (const k of [1, 2]) {
    it(`paints a map at k = ${k} exactly as paintMap on the page does`, () => {
      vi.stubGlobal("OffscreenCanvas", RecordingOffscreenCanvas);
      const cell = 48 * k;
      // What map-canvas.tsx posts, through the structured clone postMessage applies.
      const request: PaintRequest = structuredClone({ id: 7, spec: spec(), paint: painted, cell });
      const responses: { response: PaintResponse; transfer: Transferable[] }[] = [];
      handleRequest(request, (response, transfer) => responses.push({ response, transfer }));
      expect(responses).toHaveLength(1);
      const { response, transfer } = responses[0]!;
      if (!("bitmap" in response)) throw new Error(response.error);
      expect(response.id).toBe(7);
      expect(transfer).toEqual([response.bitmap]);
      const bitmap = response.bitmap as FakeBitmap;
      const size = mapPixelSize(request.spec, cell);
      expect([bitmap.width, bitmap.height]).toEqual([size.width, size.height]);

      // The main thread's paint (the fallback, and what every page painted before HD5).
      const main = recordingContext();
      paintMap(main.ctx, spec(), { cell, paint: painted });
      expect(bitmap.recording!.pixels.length).toBeGreaterThan(0);
      expect(bitmap.recording!.pixels).toEqual(main.recording.pixels);
      expect(bitmap.recording!.calls.length).toBeGreaterThan(100);
      expect(bitmap.recording!.calls).toEqual(main.recording.calls);
    });
  }

  it("answers with an error (no bitmap) when the canvas has no 2D context", () => {
    vi.stubGlobal("OffscreenCanvas", class { getContext() { return null; } });
    const responses: PaintResponse[] = [];
    handleRequest({ id: 3, spec: spec(), paint: {}, cell: 48 }, (response) => responses.push(response));
    expect(responses).toEqual([{ id: 3, error: expect.any(String) }]);
  });
});

// ---------------------------------------------------------------------------------------------------- client

class FakePort implements PaintPort {
  posted: PaintRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<PaintResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  postMessage(message: PaintRequest) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  /** The worker answers request `id`. */
  answer(id: number, bitmap: FakeBitmap | null = fakeBitmap()) {
    this.onmessage!({ data: bitmap ? { id, bitmap } : { id, error: "boom" } } as MessageEvent<PaintResponse>);
  }
}

const job = (cell: number) => ({ spec: { w: 2, h: 2 }, paint: {}, cell });
const callbacks = () => {
  const drawn: ImageBitmap[] = [];
  let failed = 0;
  const cb: PaintCallbacks = { onBitmap: (b) => drawn.push(b), onFail: () => void failed++ };
  return { cb, drawn, failed: () => failed };
};

describe("paint worker client: the newest request wins", () => {
  it("starts the worker on the first request and hands the newest picture to its caller", () => {
    const port = new FakePort();
    const start = vi.fn(() => port);
    const client = new PaintWorkerClient(start);
    expect(start).not.toHaveBeenCalled();
    const a = callbacks();
    const id = client.request(job(96), a.cb);
    expect(start).toHaveBeenCalledTimes(1);
    expect(port.posted).toEqual([{ id, spec: { w: 2, h: 2 }, paint: {}, cell: 96 }]);
    expect(client.isPending(id)).toBe(true);
    const bitmap = fakeBitmap();
    port.answer(id, bitmap);
    expect(a.drawn).toEqual([bitmap]);
    expect(bitmap.closed).toBe(false); // the caller draws it, then closes it
    expect(client.isPending(id)).toBe(false);
  });

  it("closes a superseded request's picture and never hands it out; a waiting request replaces the one before it", () => {
    const port = new FakePort();
    const client = new PaintWorkerClient(() => port);
    const first = callbacks();
    const second = callbacks();
    const third = callbacks();
    const a = client.request(job(96), first.cb);
    const b = client.request(job(120), second.cb);
    const c = client.request(job(144), third.cb);
    // One request at a time in the worker: b and c wait in one slot, c replaced b.
    expect(port.posted.map((r) => r.id)).toEqual([a]);
    expect([client.isPending(a), client.isPending(b), client.isPending(c)]).toEqual([false, false, true]);

    const stale = fakeBitmap();
    port.answer(a, stale);
    expect(stale.closed).toBe(true);
    expect(first.drawn).toEqual([]);
    expect(second.drawn).toEqual([]);
    // Then the newest is sent (b never is).
    expect(port.posted.map((r) => r.id)).toEqual([a, c]);
    const fresh = fakeBitmap();
    port.answer(c, fresh);
    expect(third.drawn).toEqual([fresh]);
    expect(fresh.closed).toBe(false);
    expect([first.failed(), second.failed(), third.failed()]).toEqual([0, 0, 0]);
  });

  it("cancel drops every request: a picture still on its way is closed when it arrives", () => {
    const port = new FakePort();
    const client = new PaintWorkerClient(() => port);
    const a = callbacks();
    const id = client.request(job(96), a.cb);
    client.cancel();
    expect(client.isPending(id)).toBe(false);
    const late = fakeBitmap();
    port.answer(id, late);
    expect(late.closed).toBe(true);
    expect(a.drawn).toEqual([]);
  });

  it("a request the worker could not paint fails to its caller (the main thread paints it)", () => {
    const port = new FakePort();
    const client = new PaintWorkerClient(() => port);
    const a = callbacks();
    const id = client.request(job(96), a.cb);
    port.answer(id, null);
    expect(a.failed()).toBe(1);
    expect(a.drawn).toEqual([]);
  });

  it("a worker that fails to load fails the newest request and every later one; it is stopped", () => {
    const port = new FakePort();
    const start = vi.fn(() => port);
    const client = new PaintWorkerClient(start);
    const a = callbacks();
    const b = callbacks();
    client.request(job(96), a.cb);
    client.request(job(120), b.cb);
    port.onerror!(new Event("error"));
    expect(port.terminated).toBe(true);
    expect([a.failed(), b.failed()]).toEqual([0, 1]);
    const c = callbacks();
    client.request(job(144), c.cb);
    expect(c.failed()).toBe(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("a worker that cannot be started fails the request", () => {
    const client = new PaintWorkerClient(() => {
      throw new Error("blocked");
    });
    const a = callbacks();
    client.request(job(96), a.cb);
    expect(a.failed()).toBe(1);
  });

  it("dispose stops the worker; its late picture is closed", () => {
    const port = new FakePort();
    const client = new PaintWorkerClient(() => port);
    const a = callbacks();
    const id = client.request(job(96), a.cb);
    client.dispose();
    expect(port.terminated).toBe(true);
    const late = fakeBitmap();
    port.answer(id, late);
    expect(late.closed).toBe(true);
    expect(a.drawn).toEqual([]);
  });
});
