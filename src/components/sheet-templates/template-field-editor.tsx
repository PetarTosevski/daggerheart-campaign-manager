"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
  Minus,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";

import {
  publishTemplateVersionAction,
  reviseTemplateVersionAction,
  saveTemplateFieldsAction,
  type FieldEditorActionState,
} from "@/app/(app)/characters/templates/field-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TemplateEditorData } from "@/lib/data/sheet-templates";
import {
  clampRect,
  clampZoom,
  COMPUTED_FORMULAS,
  DEFAULT_ZOOM,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  MAX_ZOOM,
  MIN_ZOOM,
  normalizeFieldKey,
  OPTION_FIELD_TYPES,
  RESERVED_FIELD_KEYS,
  ZOOM_STEP,
  type SheetFieldDefinition,
  type SheetFieldType,
} from "@/lib/domain/sheet-templates";
import { useHydrated } from "@/lib/hooks/use-hydrated";

const initialState: FieldEditorActionState = { status: "idle" };
const inputClass =
  "h-9 w-full rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900 outline-none focus-visible:border-amber-700 focus-visible:ring-2 focus-visible:ring-amber-700/20 disabled:opacity-60";

type EditorField = SheetFieldDefinition & { clientId: string };

function toEditorFields(rows: TemplateEditorData["fields"]): EditorField[] {
  return rows.map((row) => ({
    clientId: row.id,
    field_key: row.field_key,
    label: row.label,
    field_type: row.field_type as SheetFieldType,
    page_number: row.page_number,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    configuration:
      row.configuration && typeof row.configuration === "object"
        ? (row.configuration as Record<string, unknown>)
        : {},
    display_order: row.display_order,
    is_required: row.is_required,
    is_active: row.is_active,
  }));
}

function uniqueKey(base: string, fields: EditorField[]): string {
  const active = new Set(
    fields.filter((f) => f.is_active).map((f) => f.field_key.toLowerCase()),
  );
  if (!active.has(base)) return base;
  let n = 2;
  while (active.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function TemplateFieldEditor({ data }: { data: TemplateEditorData }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const editable = data.version.layout_status === "draft";

  const [fields, setFields] = useState<EditorField[]>(() =>
    toEditorFields(data.fields),
  );
  // Monotonic, render-pure client ids for new fields (used only for React keys
  // and selection within this editor session).
  const idCounter = useRef(0);
  const makeClientId = () => `field_new_${(idCounter.current += 1)}`;
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [saveState, saveAction, savePending] = useActionState(
    saveTemplateFieldsAction,
    initialState,
  );
  const [publishState, publishAction, publishPending] = useActionState(
    publishTemplateVersionAction,
    initialState,
  );
  const [reviseState, reviseAction, revisePending] = useActionState(
    reviseTemplateVersionAction,
    initialState,
  );

  // Clear the dirty flag once a save succeeds. Deferred so it reacts to the
  // async action result rather than mutating state during the effect pass.
  useEffect(() => {
    if (saveState.status !== "success") return;
    const id = setTimeout(() => setDirty(false), 0);
    return () => clearTimeout(id);
  }, [saveState.token, saveState.status]);

  // Publishing makes the version read-only: reload server data.
  useEffect(() => {
    if (publishState.status === "success") router.refresh();
  }, [publishState.token, publishState.status, router]);

  // A new revision opens in its own editor.
  useEffect(() => {
    if (reviseState.status === "success" && reviseState.newVersionId) {
      router.push(
        `/characters/templates/${data.version.template_id}/edit/${reviseState.newVersionId}`,
      );
    }
  }, [reviseState.token, reviseState.status, reviseState.newVersionId, data.version.template_id, router]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const mutate = useCallback((next: EditorField[]) => {
    setFields(next);
    setDirty(true);
  }, []);

  const updateField = useCallback(
    (clientId: string, patch: Partial<EditorField>) => {
      setFields((prev) =>
        prev.map((f) => (f.clientId === clientId ? { ...f, ...patch } : f)),
      );
      setDirty(true);
    },
    [],
  );

  function addField(type: SheetFieldType) {
    const key = uniqueKey(normalizeFieldKey(`${type} field`), fields);
    const field: EditorField = {
      clientId: makeClientId(),
      field_key: key,
      label: FIELD_TYPE_LABELS[type],
      field_type: type,
      page_number: page,
      x: 0.4,
      y: 0.4,
      width: 0.2,
      height: 0.05,
      configuration: {},
      display_order: fields.length,
      is_required: false,
      is_active: true,
    };
    mutate([...fields, field]);
    setSelectedId(field.clientId);
  }

  function duplicateField(clientId: string) {
    const src = fields.find((f) => f.clientId === clientId);
    if (!src) return;
    const copy: EditorField = {
      ...src,
      clientId: makeClientId(),
      field_key: uniqueKey(`${src.field_key}_copy`.slice(0, 60), fields),
      x: clampRect({ ...src, x: src.x + 0.02, y: src.y + 0.02 }).x,
      y: clampRect({ ...src, x: src.x + 0.02, y: src.y + 0.02 }).y,
      display_order: fields.length,
    };
    mutate([...fields, copy]);
    setSelectedId(copy.clientId);
  }

  function deleteField(clientId: string) {
    mutate(fields.filter((f) => f.clientId !== clientId));
    setSelectedId(null);
  }

  const selected = fields.find((f) => f.clientId === selectedId) ?? null;
  const pageFields = fields.filter((f) => f.page_number === page && f.is_active);
  const fieldsForSave: SheetFieldDefinition[] = fields.map((f, index) => ({
    field_key: f.field_key,
    label: f.label,
    field_type: f.field_type,
    page_number: f.page_number,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    configuration: f.configuration,
    display_order: index,
    is_required: f.is_required,
    is_active: f.is_active,
  }));

  return (
    <div className="space-y-4">
      <Toolbar
        editable={editable}
        dirty={dirty}
        page={page}
        pageCount={data.version.page_count}
        zoom={zoom}
        versionNumber={data.version.version_number}
        layoutStatus={data.version.layout_status}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(data.version.page_count, p + 1))}
        onZoomOut={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
        onZoomIn={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
      />

      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Add field
          </span>
          {FIELD_TYPES.map((type) => (
            <Button
              key={type}
              type="button"
              variant="outline"
              size="sm"
              disabled={!hydrated}
              onClick={() => addField(type)}
              className="border-stone-300"
            >
              <Plus className="size-3" />
              {FIELD_TYPE_LABELS[type]}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <PdfOverlayCanvas
          signedUrl={data.signedUrl}
          page={page}
          zoom={zoom}
          fields={pageFields}
          selectedId={selectedId}
          editable={editable}
          onSelect={setSelectedId}
          onMove={(clientId, rect) => updateField(clientId, rect)}
        />

        <div className="space-y-4">
          {selected ? (
            <FieldInspector
              key={selected.clientId}
              field={selected}
              editable={editable}
              pageCount={data.version.page_count}
              existingKeys={fields
                .filter((f) => f.clientId !== selected.clientId && f.is_active)
                .map((f) => f.field_key.toLowerCase())}
              onChange={(patch) => updateField(selected.clientId, patch)}
              onDuplicate={() => duplicateField(selected.clientId)}
              onDelete={() => deleteField(selected.clientId)}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-stone-300 bg-white/60 px-4 py-8 text-center text-sm text-stone-500">
              {editable
                ? "Select a field to edit it, or add one from the toolbar."
                : "This version is published and read-only."}
            </p>
          )}

          {editable ? (
            <div className="space-y-2">
              <form action={saveAction}>
                <input
                  type="hidden"
                  name="templateVersionId"
                  value={data.version.id}
                />
                <input type="hidden" name="pageCount" value={data.version.page_count} />
                <input
                  type="hidden"
                  name="fields"
                  value={JSON.stringify(fieldsForSave)}
                  readOnly
                />
                <Button
                  type="submit"
                  disabled={!hydrated || savePending}
                  className="w-full bg-[#3f1e25] text-amber-50 hover:bg-[#542832]"
                >
                  {savePending ? <LoaderCircle className="animate-spin" /> : <Save />}
                  {savePending ? "Saving…" : "Save layout"}
                </Button>
              </form>

              <form action={publishAction}>
                <input
                  type="hidden"
                  name="templateVersionId"
                  value={data.version.id}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!hydrated || publishPending || dirty}
                  className="w-full border-stone-300"
                  title={dirty ? "Save before publishing" : undefined}
                >
                  {publishPending ? <LoaderCircle className="animate-spin" /> : <Send />}
                  Publish layout
                </Button>
              </form>
              {dirty ? (
                <p className="text-xs text-amber-700">
                  Save your changes before publishing.
                </p>
              ) : null}
            </div>
          ) : (
            <form action={reviseAction}>
              <input type="hidden" name="sourceVersionId" value={data.version.id} />
              <Button
                type="submit"
                disabled={!hydrated || revisePending}
                className="w-full bg-[#3f1e25] text-amber-50 hover:bg-[#542832]"
              >
                {revisePending ? <LoaderCircle className="animate-spin" /> : <Copy />}
                Create draft revision
              </Button>
            </form>
          )}

          <StatusLine
            states={[saveState, publishState, reviseState]}
          />
        </div>
      </div>
    </div>
  );
}

function StatusLine({ states }: { states: FieldEditorActionState[] }) {
  // Surface any error first; otherwise the first success. (Only one action runs
  // at a time, so a simple priority read is sufficient and avoids ordering by
  // the non-chronological result token.)
  const active = states.filter((s) => s.status !== "idle");
  const latest =
    active.find((s) => s.status === "error") ??
    active.find((s) => s.status === "success");
  if (!latest) return null;
  return (
    <div
      role={latest.status === "error" ? "alert" : "status"}
      className={`rounded-lg border px-3 py-2 text-sm ${
        latest.status === "error"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {latest.message}
    </div>
  );
}

function Toolbar({
  editable,
  dirty,
  page,
  pageCount,
  zoom,
  versionNumber,
  layoutStatus,
  onPrev,
  onNext,
  onZoomOut,
  onZoomIn,
}: {
  editable: boolean;
  dirty: boolean;
  page: number;
  pageCount: number;
  zoom: number;
  versionNumber: number;
  layoutStatus: string;
  onPrev: () => void;
  onNext: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white/80 px-3 py-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="border-stone-300 bg-stone-100 text-stone-600">
          v{versionNumber}
        </Badge>
        {layoutStatus === "published" ? (
          <Badge variant="outline" className="border-emerald-700/20 bg-emerald-50 text-emerald-800">
            <Lock className="size-3" /> Published
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-700/20 bg-amber-50 text-amber-800">
            Draft
          </Badge>
        )}
        {editable && dirty ? (
          <span className="text-xs font-medium text-amber-700">Unsaved changes</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="min-w-24 text-center text-sm text-stone-600">
          Page {page} of {pageCount}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={page >= pageCount} aria-label="Next page">
          <ChevronRight />
        </Button>
        <span aria-hidden className="mx-1 h-5 w-px bg-stone-300" />
        <Button type="button" variant="outline" size="sm" onClick={onZoomOut} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
          <Minus />
        </Button>
        <span className="min-w-12 text-center text-sm tabular-nums text-stone-600">
          {Math.round(zoom * 100)}%
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onZoomIn} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
          <Plus />
        </Button>
      </div>
    </div>
  );
}

type PageSize = { width: number; height: number };

function PdfOverlayCanvas({
  signedUrl,
  page,
  zoom,
  fields,
  selectedId,
  editable,
  onSelect,
  onMove,
}: {
  signedUrl: string | null;
  page: number;
  zoom: number;
  fields: EditorField[];
  selectedId: string | null;
  editable: boolean;
  onSelect: (clientId: string) => void;
  onMove: (clientId: string, rect: { x: number; y: number; width: number; height: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<{ getPage: (n: number) => Promise<PdfPageLike> } | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    signedUrl ? "loading" : "error",
  );
  const [size, setSize] = useState<PageSize>({ width: 0, height: 0 });

  useEffect(() => {
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
  }, [signedUrl]);

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
      // Cancellations on rapid page/zoom changes are expected.
    }
  }, [page, zoom, status]);

  useEffect(() => {
    void renderPage();
    return () => renderTaskRef.current?.cancel();
  }, [renderPage]);

  return (
    <div className="overflow-auto rounded-lg border border-stone-300 bg-stone-100 p-4">
      {status === "loading" ? (
        <p className="p-8 text-center text-sm text-stone-500">Loading page…</p>
      ) : null}
      {status === "error" ? (
        <p className="p-8 text-center text-sm text-red-700">
          The page preview could not be loaded.
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
        <canvas ref={canvasRef} className="block shadow-sm" />
        {size.width > 0
          ? fields.map((field) => (
              <FieldBox
                key={field.clientId}
                field={field}
                pageSize={size}
                selected={field.clientId === selectedId}
                editable={editable}
                onSelect={() => onSelect(field.clientId)}
                onMove={(rect) => onMove(field.clientId, rect)}
              />
            ))
          : null}
      </div>
    </div>
  );
}

function FieldBox({
  field,
  pageSize,
  selected,
  editable,
  onSelect,
  onMove,
}: {
  field: EditorField;
  pageSize: PageSize;
  selected: boolean;
  editable: boolean;
  onSelect: () => void;
  onMove: (rect: { x: number; y: number; width: number; height: number }) => void;
}) {
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: { x: number; y: number; width: number; height: number };
  } | null>(null);

  function onPointerDown(mode: "move" | "resize", event: React.PointerEvent) {
    if (!editable) {
      onSelect();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      orig: { x: field.x, y: field.y, width: field.width, height: field.height },
    };
  }

  function onPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / pageSize.width;
    const dy = (event.clientY - drag.startY) / pageSize.height;
    if (drag.mode === "move") {
      onMove(
        clampRect({
          x: drag.orig.x + dx,
          y: drag.orig.y + dy,
          width: drag.orig.width,
          height: drag.orig.height,
        }),
      );
    } else {
      onMove(
        clampRect({
          x: drag.orig.x,
          y: drag.orig.y,
          width: drag.orig.width + dx,
          height: drag.orig.height + dy,
        }),
      );
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    dragRef.current = null;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Field ${field.field_key}`}
      onPointerDown={(e) => onPointerDown("move", e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        left: `${field.x * pageSize.width}px`,
        top: `${field.y * pageSize.height}px`,
        width: `${field.width * pageSize.width}px`,
        height: `${field.height * pageSize.height}px`,
      }}
      className={[
        "absolute flex items-center justify-center overflow-hidden rounded-sm border text-[10px] select-none",
        editable ? "cursor-move" : "cursor-pointer",
        selected
          ? "border-amber-600 bg-amber-500/25 ring-2 ring-amber-500"
          : "border-sky-500/70 bg-sky-400/20 hover:bg-sky-400/30",
      ].join(" ")}
    >
      <span className="pointer-events-none truncate px-1 text-stone-800">
        {field.field_key}
      </span>
      {editable ? (
        <span
          onPointerDown={(e) => onPointerDown("resize", e)}
          className="absolute right-0 bottom-0 size-3 cursor-se-resize rounded-tl-sm bg-amber-600"
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

function FieldInspector({
  field,
  editable,
  pageCount,
  existingKeys,
  onChange,
  onDuplicate,
  onDelete,
}: {
  field: EditorField;
  editable: boolean;
  pageCount: number;
  existingKeys: string[];
  onChange: (patch: Partial<EditorField>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const keyTaken = existingKeys.includes(field.field_key.toLowerCase());
  const isOption = OPTION_FIELD_TYPES.includes(field.field_type);
  const options = Array.isArray(field.configuration.options)
    ? (field.configuration.options as string[])
    : [];

  function setConfig(patch: Record<string, unknown>) {
    onChange({ configuration: { ...field.configuration, ...patch } });
  }

  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-white/85 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">Field</h3>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onDuplicate} disabled={!editable} aria-label="Duplicate field">
            <Copy className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ is_active: !field.is_active })}
            disabled={!editable}
            aria-label={field.is_active ? "Deactivate field" : "Activate field"}
          >
            {field.is_active ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={!editable} aria-label="Delete field">
            <Trash2 className="size-4 text-red-700" />
          </Button>
        </div>
      </div>

      <label className="block text-xs font-medium text-stone-600">
        Key
        <input
          className={inputClass}
          value={field.field_key}
          disabled={!editable}
          onChange={(e) => onChange({ field_key: e.target.value })}
          aria-invalid={keyTaken}
        />
      </label>
      {keyTaken ? <p className="text-xs text-red-700">Key already used.</p> : null}
      {RESERVED_FIELD_KEYS.includes(
        field.field_key as (typeof RESERVED_FIELD_KEYS)[number],
      ) ? (
        <p className="text-xs text-stone-500">Reserved key (editable field for now).</p>
      ) : null}

      <label className="block text-xs font-medium text-stone-600">
        Label
        <input
          className={inputClass}
          value={field.label}
          disabled={!editable}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </label>

      <label className="block text-xs font-medium text-stone-600">
        Type
        <select
          className={inputClass}
          value={field.field_type}
          disabled={!editable}
          onChange={(e) => onChange({ field_type: e.target.value as SheetFieldType })}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs font-medium text-stone-600">
          Page
          <input
            type="number"
            min={1}
            max={pageCount}
            className={inputClass}
            value={field.page_number}
            disabled={!editable}
            onChange={(e) =>
              onChange({
                page_number: Math.min(
                  pageCount,
                  Math.max(1, Number(e.target.value) || 1),
                ),
              })
            }
          />
        </label>
        <label className="flex items-end gap-2 text-xs font-medium text-stone-600">
          <input
            type="checkbox"
            className="size-4"
            checked={field.is_required}
            disabled={!editable}
            onChange={(e) => onChange({ is_required: e.target.checked })}
          />
          Required
        </label>
      </div>

      {/* Numeric placement alternative to dragging. */}
      <fieldset className="grid grid-cols-4 gap-2">
        <legend className="mb-1 text-xs font-medium text-stone-600">
          Position &amp; size (0–1)
        </legend>
        {(["x", "y", "width", "height"] as const).map((prop) => (
          <label key={prop} className="block text-[10px] text-stone-500 uppercase">
            {prop}
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              className={inputClass}
              value={Number(field[prop].toFixed(3))}
              disabled={!editable}
              onChange={(e) =>
                onChange(
                  clampRect({
                    x: field.x,
                    y: field.y,
                    width: field.width,
                    height: field.height,
                    [prop]: Number(e.target.value),
                  } as never),
                )
              }
            />
          </label>
        ))}
      </fieldset>

      {isOption ? (
        <label className="block text-xs font-medium text-stone-600">
          Options (one per line)
          <textarea
            className="min-h-20 w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900"
            value={options.join("\n")}
            disabled={!editable}
            onChange={(e) =>
              setConfig({
                options: e.target.value
                  .split("\n")
                  .map((o) => o.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      ) : null}

      {field.field_type === "computed" ? (
        <label className="block text-xs font-medium text-stone-600">
          Formula (stored only; not evaluated yet)
          <select
            className={inputClass}
            value={String(field.configuration.formula ?? "none")}
            disabled={!editable}
            onChange={(e) => setConfig({ formula: e.target.value })}
          >
            {COMPUTED_FORMULAS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {field.field_type !== "checkbox" && field.field_type !== "computed" ? (
        <label className="block text-xs font-medium text-stone-600">
          Placeholder
          <input
            className={inputClass}
            value={String(field.configuration.placeholder ?? "")}
            disabled={!editable}
            onChange={(e) => setConfig({ placeholder: e.target.value })}
          />
        </label>
      ) : null}
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
