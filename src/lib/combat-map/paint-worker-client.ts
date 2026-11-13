// The page's side of the paint worker (plan sharp-4k HD5, paint-worker.ts). The newest request wins: at most one
// request is in the worker at a time, a newer one waits in a single slot (replacing any that waited before it), and
// a picture that comes back for a request that is no longer the newest is closed, never handed out. The caller keeps
// its old picture on screen until `onBitmap` gives it the new one.

import type { PaintJob, PaintRequest, PaintResponse } from "./paint-worker";

/** The part of a Worker the client uses (tests pass a fake one). */
export interface PaintPort {
  postMessage(message: PaintRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<PaintResponse>) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export interface PaintCallbacks {
  /** The newest request's picture; the callee draws it and closes it. */
  onBitmap(bitmap: ImageBitmap): void;
  /** The worker could not paint it (it failed to load or threw): the callee paints on the main thread instead. */
  onFail(): void;
}

/** Whether this browser can paint in a worker (module Worker, OffscreenCanvas with a 2D context, ImageBitmap). */
export function canPaintOffThread(): boolean {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof ImageBitmap === "undefined") return false;
  try {
    return new OffscreenCanvas(1, 1).getContext("2d") !== null;
  } catch {
    return false;
  }
}

/** Starts the paint worker (a module worker bundled by Next.js from paint-worker.ts). */
export function startPaintWorker(): PaintPort {
  return new Worker(new URL("./paint-worker.ts", import.meta.url), { type: "module", name: "combat-map-paint" }) as PaintPort;
}

type Pending = { request: PaintRequest; callbacks: PaintCallbacks };

export class PaintWorkerClient {
  private port: PaintPort | null = null;
  private broken = false;
  private lastId = 0;
  /** The newest request's id; 0 after cancel(). A response for any other id is stale. */
  private newest = 0;
  private inFlight: Pending | null = null;
  private waiting: Pending | null = null;

  constructor(private readonly start: () => PaintPort = startPaintWorker) {}

  /** Paints `job` in the worker; supersedes every earlier request. Returns the request's id. */
  request(job: PaintJob, callbacks: PaintCallbacks): number {
    const id = ++this.lastId;
    this.newest = id;
    const pending: Pending = { request: { id, spec: job.spec, paint: job.paint, cell: job.cell }, callbacks };
    if (this.broken) {
      callbacks.onFail();
      return id;
    }
    if (this.inFlight === null) this.send(pending);
    else this.waiting = pending;
    return id;
  }

  /** Whether `id` is the newest request and its picture has not arrived yet. */
  isPending(id: number): boolean {
    return id === this.newest && (this.inFlight?.request.id === id || this.waiting?.request.id === id);
  }

  /** Drops every request: a picture still on its way is closed when it arrives. */
  cancel(): void {
    this.newest = 0;
    this.waiting = null;
  }

  /** Stops the worker; the client must not be used afterwards. */
  dispose(): void {
    this.cancel();
    this.inFlight = null;
    this.port?.terminate();
    this.port = null;
  }

  private send(pending: Pending) {
    try {
      this.port ??= this.open();
      this.inFlight = pending;
      this.port.postMessage(pending.request);
    } catch {
      // No worker here after all (blocked or failed to start): the main thread paints from now on.
      this.broken = true;
      this.fail(pending);
    }
  }

  private open(): PaintPort {
    const port = this.start();
    port.onmessage = (event) => this.received(event.data);
    port.onerror = (event) => {
      // The module failed to load or threw outside a request: paint everything on the main thread from now on.
      event.preventDefault?.();
      const lost = [this.inFlight, this.waiting];
      this.inFlight = null;
      this.waiting = null;
      this.broken = true;
      port.terminate();
      if (this.port === port) this.port = null;
      for (const pending of lost) if (pending !== null) this.fail(pending);
    };
    return port;
  }

  private received(response: PaintResponse) {
    const done = this.inFlight?.request.id === response.id ? this.inFlight : null;
    if (done !== null) this.inFlight = null;
    const current = done !== null && response.id === this.newest;
    if ("bitmap" in response) {
      if (current) done.callbacks.onBitmap(response.bitmap);
      else response.bitmap.close();
    } else if (current) done.callbacks.onFail();
    const next = this.waiting;
    if (next !== null && this.inFlight === null) {
      this.waiting = null;
      this.send(next);
    }
  }

  private fail(pending: Pending) {
    this.inFlight = this.inFlight === pending ? null : this.inFlight;
    if (pending.request.id === this.newest) pending.callbacks.onFail();
  }
}
