"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Minus,
  Plus,
  TriangleAlert,
} from "lucide-react";

import { saveCharacterSheetValueAction } from "@/app/(app)/characters/[characterId]/sheet-actions";
import { Button } from "@/components/ui/button";
import type { CharacterSheetRuntimeData, RuntimeField } from "@/lib/data/character-sheet";
import {
  checkboxChecked,
  clampSaveState,
  isLatestSave,
  isReadOnlyField,
  normalizeSheetValue,
  optionsFromConfig,
  SHEET_SAVE_STATE_LABELS,
  stepCounter,
  toPixelRect,
  type SheetSaveState,
} from "@/lib/domain/character-sheet";
import {
  clampZoom,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
} from "@/lib/domain/sheet-templates";

const AUTOSAVE_DEBOUNCE_MS = 800;

type ReadyData = Extract<CharacterSheetRuntimeData, { state: "ready" }>;

type FieldMeta = {
  updatedAt: string; // "" when never persisted
  state: SheetSaveState;
  error?: string;
  latestSeq: number;
};

export function CharacterSheetRuntime({ data }: { data: ReadyData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<{ getPage: (n: number) => Promise<PdfPageLike> } | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    data.signedUrl ? "loading" : "error",
  );
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const [values, setValues] = useState<Record<string, string | null>>(() => {
    const initial: Record<string, string | null> = {};
    for (const field of data.fields) {
      initial[field.id] = data.values[field.id]?.value ?? null;
    }
    return initial;
  });
  const [meta, setMeta] = useState<Record<string, FieldMeta>>(() => {
    const initial: Record<string, FieldMeta> = {};
    for (const field of data.fields) {
      initial[field.id] = {
        updatedAt: data.values[field.id]?.updated_at ?? "",
        state: "idle",
        latestSeq: 0,
      };
    }
    return initial;
  });

  // Load the PDF document once.
  useEffect(() => {
    const signedUrl = data.signedUrl;
    if (!signedUrl) return;
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
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.signedUrl]);

  const renderPage = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || status !== "ready") return;
    const context = canvas.getContext("2d");
    try {
      renderTaskRef.current?.cancel();
      const pdfPage = await doc.getPage(page);
      const viewport = pdfPage.getViewport({ scale: zoom });
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);
      canvas.width = width;
      canvas.height = height;
      setSize({ width, height });
      if (context) {
        const task = pdfPage.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
      }
    } catch {
      // Cancellations on rapid page/zoom change are expected.
    }
  }, [page, zoom, status]);

  useEffect(() => {
    void renderPage();
    return () => renderTaskRef.current?.cancel();
  }, [renderPage]);

  const runSave = useCallback(
    async (field: RuntimeField, nextValue: string | null) => {
      const check = normalizeSheetValue(field.field_type, nextValue, field.configuration as Record<string, unknown>);
      if (!check.ok) {
        setMeta((m) => ({
          ...m,
          [field.id]: { ...m[field.id], state: "error", error: check.error },
        }));
        return;
      }

      const seq = (meta[field.id]?.latestSeq ?? 0) + 1;
      setMeta((m) => ({
        ...m,
        [field.id]: { ...m[field.id], state: "saving", error: undefined, latestSeq: seq },
      }));

      const result = await saveCharacterSheetValueAction({
        characterId: data.characterId,
        templateFieldId: field.id,
        value: check.value ?? "",
        expectedUpdatedAt: meta[field.id]?.updatedAt ?? "",
      });

      setMeta((m) => {
        const current = m[field.id];
        // Ignore a stale response superseded by a newer edit.
        if (!current || !isLatestSave(seq, current.latestSeq)) return m;
        if (result.status === "saved") {
          return { ...m, [field.id]: { ...current, updatedAt: result.updatedAt, state: "saved", error: undefined } };
        }
        if (result.status === "conflict") {
          return {
            ...m,
            [field.id]: { ...current, state: "error", error: "Changed elsewhere. Reload to see the latest." },
          };
        }
        return { ...m, [field.id]: { ...current, state: "error", error: result.message } };
      });
    },
    [data.characterId, meta],
  );

  const scheduleSave = useCallback(
    (field: RuntimeField, nextValue: string | null) => {
      setValues((v) => ({ ...v, [field.id]: nextValue }));
      setMeta((m) => ({ ...m, [field.id]: { ...m[field.id], state: "unsaved", error: undefined } }));
      const timers = timersRef.current;
      const existing = timers.get(field.id);
      if (existing) clearTimeout(existing);
      timers.set(
        field.id,
        setTimeout(() => {
          timers.delete(field.id);
          void runSave(field, nextValue);
        }, AUTOSAVE_DEBOUNCE_MS),
      );
    },
    [runSave],
  );

  // Best-effort flush of pending debounced saves when unmounting (e.g. leaving
  // the tab); also warn on full-page unload while changes are in flight.
  useEffect(() => {
    const timers = timersRef.current;
    const handler = (event: BeforeUnloadEvent) => {
      const pending = Object.values(meta).some(
        (m) => m.state === "saving" || m.state === "unsaved",
      );
      if (pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      for (const [fieldId, timer] of timers) {
        clearTimeout(timer);
        const field = data.fields.find((f) => f.id === fieldId);
        if (field) void runSave(field, values[fieldId] ?? null);
      }
      timers.clear();
    };
    // Intentionally runs once; flush uses the latest refs at unmount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overall = clampSaveState(Object.values(meta).map((m) => m.state));
  const pageFields = data.fields.filter((f) => f.page_number === page);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span className="min-w-24 text-center text-sm text-stone-600" aria-live="polite">
            Page {page} of {data.version.page_count}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setPage((p) => Math.min(data.version.page_count, p + 1))} disabled={page >= data.version.page_count} aria-label="Next page">
            <ChevronRight />
          </Button>
          <span aria-hidden className="mx-1 h-5 w-px bg-stone-300" />
          <Button type="button" variant="outline" size="sm" onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
            <Minus />
          </Button>
          <span className="min-w-12 text-center text-sm tabular-nums text-stone-600">{Math.round(zoom * 100)}%</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
            <Plus />
          </Button>
        </div>
        <SaveStatus state={overall} />
      </div>

      <div className="max-w-full overflow-auto rounded-lg border border-stone-300 bg-stone-100 p-4">
        {status === "loading" ? (
          <p className="p-8 text-center text-sm text-stone-500">Loading sheet…</p>
        ) : null}
        {status === "error" ? (
          <p className="p-8 text-center text-sm text-red-700">
            The sheet PDF could not be loaded. Reload the page to try again.
          </p>
        ) : null}
        <div
          className="relative mx-auto"
          style={{
            width: size.width || undefined,
            height: size.height || undefined,
            display: status === "ready" ? "block" : "none",
          }}
        >
          <canvas ref={canvasRef} className="block shadow-sm" aria-hidden="true" />
          {size.width > 0
            ? pageFields.map((field) => (
                <FieldControl
                  key={field.id}
                  field={field}
                  pageSize={size}
                  value={values[field.id] ?? null}
                  meta={meta[field.id]}
                  onChange={(next) => scheduleSave(field, next)}
                />
              ))
            : null}
        </div>
      </div>
    </div>
  );
}

function SaveStatus({ state }: { state: SheetSaveState }) {
  if (state === "idle") return null;
  const label = SHEET_SAVE_STATE_LABELS[state];
  const isError = state === "error";
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 text-sm ${
        isError ? "text-red-700" : state === "saved" ? "text-emerald-700" : "text-stone-600"
      }`}
    >
      {state === "saving" ? <LoaderCircle className="size-4 animate-spin" /> : null}
      {state === "saved" ? <CheckCircle2 className="size-4" /> : null}
      {isError ? <TriangleAlert className="size-4" /> : null}
      {label}
    </span>
  );
}

const controlClass =
  "h-full w-full rounded-sm border border-stone-400/70 bg-white/95 px-1 text-sm text-stone-900 outline-none focus-visible:border-amber-700 focus-visible:ring-2 focus-visible:ring-amber-700/30 disabled:bg-stone-100 disabled:text-stone-500";

function FieldControl({
  field,
  pageSize,
  value,
  meta,
  onChange,
}: {
  field: RuntimeField;
  pageSize: { width: number; height: number };
  value: string | null;
  meta: FieldMeta | undefined;
  onChange: (next: string | null) => void;
}) {
  const rect = toPixelRect(field, pageSize.width, pageSize.height);
  const config = (field.configuration ?? {}) as Record<string, unknown>;
  const readOnly = isReadOnlyField({ field_type: field.field_type, configuration: config });
  const label = field.label || field.field_key;
  const placeholder = typeof config.placeholder === "string" ? config.placeholder : undefined;
  const invalid = meta?.state === "error";

  const wrapperStyle: React.CSSProperties = {
    position: "absolute",
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };

  const common = {
    "aria-label": label,
    "aria-required": field.is_required || undefined,
    "aria-invalid": invalid || undefined,
    title: meta?.error ?? label,
  };

  function render() {
    if (field.field_type === "computed") {
      return (
        <div className={`${controlClass} flex items-center bg-stone-100 text-stone-500`} title={`${label} (computed)`}>
          <span className="truncate">{value ?? "—"}</span>
        </div>
      );
    }
    if (field.field_type === "image") {
      return (
        <div className={`${controlClass} flex items-center justify-center bg-stone-100 text-[10px] text-stone-500`} title={`${label} (image — asset library, Task 015)`}>
          Image
        </div>
      );
    }
    if (field.field_type === "multiline_text") {
      return (
        <textarea
          {...common}
          className={`${controlClass} resize-none py-1`}
          value={value ?? ""}
          readOnly={readOnly}
          disabled={readOnly}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    if (field.field_type === "checkbox") {
      return (
        <div className="flex h-full w-full items-center justify-center rounded-sm border border-stone-400/70 bg-white/95">
          <input
            {...common}
            type="checkbox"
            className="size-4"
            checked={checkboxChecked(value)}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          />
        </div>
      );
    }
    if (field.field_type === "select") {
      return (
        <select {...common} className={controlClass} value={value ?? ""} disabled={readOnly} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {optionsFromConfig(config).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }
    if (field.field_type === "radio") {
      const options = optionsFromConfig(config);
      return (
        <fieldset {...common} className="flex h-full w-full flex-wrap items-center gap-1 overflow-auto rounded-sm border border-stone-400/70 bg-white/95 px-1" aria-label={label}>
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-0.5 text-[11px]">
              <input
                type="radio"
                name={field.id}
                value={opt}
                checked={value === opt}
                disabled={readOnly}
                onChange={() => onChange(opt)}
              />
              {opt}
            </label>
          ))}
        </fieldset>
      );
    }
    if (field.field_type === "number") {
      return (
        <input {...common} type="number" className={controlClass} value={value ?? ""} readOnly={readOnly} disabled={readOnly} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      );
    }
    if (field.field_type === "counter") {
      return (
        <div className="flex h-full w-full items-center gap-0.5">
          <button type="button" aria-label={`Decrease ${label}`} disabled={readOnly} className="h-full shrink-0 rounded-sm border border-stone-400/70 bg-white px-1 text-stone-700 disabled:opacity-50" onClick={() => onChange(stepCounter(value, -1, config))}>
            −
          </button>
          <input {...common} type="number" className={controlClass} value={value ?? ""} readOnly={readOnly} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />
          <button type="button" aria-label={`Increase ${label}`} disabled={readOnly} className="h-full shrink-0 rounded-sm border border-stone-400/70 bg-white px-1 text-stone-700 disabled:opacity-50" onClick={() => onChange(stepCounter(value, 1, config))}>
            +
          </button>
        </div>
      );
    }
    // text
    return (
      <input {...common} type="text" className={controlClass} value={value ?? ""} readOnly={readOnly} disabled={readOnly} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    );
  }

  return (
    <div style={wrapperStyle} data-field-key={field.field_key} className={invalid ? "ring-2 ring-red-500" : undefined}>
      {render()}
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
