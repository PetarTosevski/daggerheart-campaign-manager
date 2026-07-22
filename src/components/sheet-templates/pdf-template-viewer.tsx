"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  clampPage,
  clampZoom,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
} from "@/lib/domain/sheet-templates";

/**
 * Read-only, multi-page PDF preview for a stored template version. It renders the
 * immutable source PDF to a canvas with page navigation and zoom. It never edits
 * the PDF, defines fields, or places overlays — that is Tasks 011B/011C.
 */
export function PdfTemplateViewer({
  signedUrl,
  pageCount,
  label,
}: {
  signedUrl: string;
  pageCount: number;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Holds the resolved pdf.js document proxy across renders.
  const docRef = useRef<{ getPage: (n: number) => Promise<PdfPageLike> } | null>(
    null,
  );
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  // Load the document once per signed URL.
  useEffect(() => {
    let cancelled = false;
    docRef.current = null;

    (async () => {
      setStatus("loading");
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({ url: signedUrl }).promise;
        if (cancelled) return;
        docRef.current = doc as unknown as {
          getPage: (n: number) => Promise<PdfPageLike>;
        };
        setPage(1);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signedUrl]);

  // Render the current page whenever the page, zoom, or document changes.
  const renderPage = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || status !== "ready") return;

    const context = canvas.getContext("2d");
    if (!context) return; // e.g. jsdom without canvas support

    try {
      renderTaskRef.current?.cancel();
      const pdfPage = await doc.getPage(page);
      const viewport = pdfPage.getViewport({ scale: zoom });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const task = pdfPage.render({ canvasContext: context, viewport });
      renderTaskRef.current = task;
      await task.promise;
    } catch {
      // Render cancellations are expected when page/zoom change quickly; ignore.
    }
  }, [page, zoom, status]);

  useEffect(() => {
    void renderPage();
    return () => renderTaskRef.current?.cancel();
  }, [renderPage]);

  const goPrev = () => setPage((p) => clampPage(p - 1, pageCount));
  const goNext = () => setPage((p) => clampPage(p + 1, pageCount));
  const zoomOut = () => setZoom((z) => clampZoom(z - ZOOM_STEP));
  const zoomIn = () => setZoom((z) => clampZoom(z + ZOOM_STEP));
  const resetZoom = () => setZoom(DEFAULT_ZOOM);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageNavigation
          page={page}
          pageCount={pageCount}
          onPrev={goPrev}
          onNext={goNext}
          disabled={status !== "ready"}
        />
        <ZoomControls
          zoom={zoom}
          onZoomOut={zoomOut}
          onZoomIn={zoomIn}
          onReset={resetZoom}
          disabled={status !== "ready"}
        />
      </div>

      <div className="relative flex min-h-64 justify-center overflow-auto rounded-lg border border-stone-300 bg-stone-100 p-4">
        {status === "loading" ? (
          <div className="flex items-center gap-2 self-center text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading preview…
          </div>
        ) : null}

        {status === "error" ? (
          <div className="flex items-center gap-2 self-center text-sm text-red-700">
            <TriangleAlert className="size-4" />
            The preview could not be loaded. Reload the page to try again.
          </div>
        ) : null}

        <canvas
          ref={canvasRef}
          aria-label={
            label ? `${label} preview, page ${page}` : `Template preview, page ${page}`
          }
          className={status === "ready" ? "h-auto max-w-full shadow-sm" : "hidden"}
        />
      </div>
    </div>
  );
}

function PageNavigation({
  page,
  pageCount,
  onPrev,
  onNext,
  disabled,
}: {
  page: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={disabled || page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-24 text-center text-sm text-stone-600" aria-live="polite">
        Page {page} of {pageCount}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={disabled || page >= pageCount}
        aria-label="Next page"
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

function ZoomControls({
  zoom,
  onZoomOut,
  onZoomIn,
  onReset,
  disabled,
}: {
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onReset: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onZoomOut}
        disabled={disabled || zoom <= MIN_ZOOM}
        aria-label="Zoom out"
      >
        <Minus />
      </Button>
      <span className="min-w-14 text-center text-sm tabular-nums text-stone-600">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onZoomIn}
        disabled={disabled || zoom >= MAX_ZOOM}
        aria-label="Zoom in"
      >
        <Plus />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onReset}
        disabled={disabled || zoom === DEFAULT_ZOOM}
        aria-label="Reset zoom"
      >
        <RotateCcw />
      </Button>
    </div>
  );
}

type PdfPageLike = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void>; cancel: () => void };
};
