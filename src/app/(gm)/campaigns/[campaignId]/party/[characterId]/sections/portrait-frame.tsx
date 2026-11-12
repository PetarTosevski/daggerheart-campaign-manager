"use client";

import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { Crop } from "lucide-react";
import { useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import {
  coverOverflow,
  dragPortraitFrame,
  nudgePortraitFrame,
  portraitFrameFromPosition,
  portraitFrameStyle,
  samePortraitFrame,
  clampPortraitFrame,
  PORTRAIT_ZOOM_MAX,
  PORTRAIT_ZOOM_MIN,
  PORTRAIT_ZOOM_STEP,
  type PortraitFrame,
} from "@/lib/party/portrait-frame";

import { api } from "../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

// The portrait close-up on the sheet (plan portrait-frame, PZ1; user 2026-11-12): the arch's picture layer, and the
// Adjust editor (zoom slider 1x-3x, drag or arrow keys to move, Reset / Cancel / Save) for whoever edits the character.

type Size = { width: number; height: number };

/**
 * The picture layer inside a clipping frame (the arch, the editor's preview): `src` as a cover background, drawn through
 * the shared style helper. No `frame`: only `fallbackPosition`, exactly as the arch drew it before the close-up.
 */
export function PortraitLayer({
  src,
  frame,
  fallbackPosition,
  className,
  children,
  ...aria
}: {
  src: string | null;
  frame: PortraitFrame | null | undefined;
  fallbackPosition: string;
  className?: string;
  children?: ReactNode;
  role?: "img";
  "aria-label"?: string;
  "aria-hidden"?: true;
}) {
  const style: CSSProperties = { backgroundImage: src ? `url(${src})` : "none", ...portraitFrameStyle(src ? frame : null, fallbackPosition) };
  return (
    <div className={className} style={style} data-testid="portrait-layer" {...aria}>
      {children}
    </div>
  );
}

/** Puts `frame` (or none) on the character in every party query the client holds: the sheet, the roster and the dashboard. */
function framedLocally(store: OptimisticLocalStore, campaignId: Id<"campaigns">, characterId: Id<"characters">, frame: PortraitFrame | null) {
  const reframe = <S extends { portraitFrame?: PortraitFrame }>(sheet: S): S => {
    const { portraitFrame: _old, ...rest } = sheet;
    void _old;
    return (frame ? { ...rest, portraitFrame: frame } : rest) as S;
  };
  const view = store.getQuery(api.charactersReads.get, { characterId });
  if (view) store.setQuery(api.charactersReads.get, { characterId }, { ...view, sheet: reframe(view.sheet) });
  const list = store.getQuery(api.charactersReads.listByCampaign, { campaignId });
  if (list) store.setQuery(api.charactersReads.listByCampaign, { campaignId }, list.map((c) => (c._id === characterId ? { ...c, sheet: reframe(c.sheet) } : c)));
  const summary = store.getQuery(api.charactersReads.partySummary, { campaignId });
  if (summary) store.setQuery(api.charactersReads.partySummary, { campaignId }, summary.map((c) => (c._id === characterId ? { ...c, sheet: reframe(c.sheet) } : c)));
}

/**
 * The Adjust editor's open state, and the picture's own size for the drag maths (how far a cover picture sticks out of
 * the preview), loaded when the editor opens (an event, not an effect).
 */
export function usePortraitAdjust(src: string | null) {
  const [open, setOpen] = useState(false);
  const [natural, setNatural] = useState<{ src: string; size: Size } | null>(null);
  return {
    open,
    natural: src !== null && natural?.src === src ? natural.size : null,
    openEditor: () => {
      setOpen(true);
      if (src === null || natural?.src === src || typeof Image === "undefined") return;
      const img = new Image();
      img.onload = () => setNatural({ src, size: { width: img.naturalWidth, height: img.naturalHeight } });
      img.src = src;
    },
    close: () => setOpen(false),
  };
}

/** "Adjust" beside the upload button, for editors of a character whose portrait shows a picture. */
export function PortraitAdjustButton({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <BrandButton variant="neutral" size="sm" onClick={onOpen} aria-label={`Adjust the portrait of ${name}`} aria-haspopup="dialog">
      <Crop aria-hidden="true" />
      Adjust
    </BrandButton>
  );
}

/**
 * The Adjust dialog. Rendered outside the arch's action overlay (whose button styles would reach it). Opens with the
 * saved frame, or (none saved) with the zoom-1 frame of the arch's current position, so nothing jumps.
 */
export function PortraitFrameDialog({
  open,
  onClose,
  natural,
  ...editor
}: {
  open: boolean;
  onClose: () => void;
  natural: Size | null;
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  name: string;
  src: string;
  saved: PortraitFrame | undefined;
  fallbackPosition: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Adjust portrait" className="max-w-[440px]">
      <PortraitFrameEditor {...editor} natural={natural} onDone={onClose} />
    </Modal>
  );
}

/**
 * The editor's body. Mounted when the dialog opens (Modal renders its children only while open), so the preview frame is
 * local state initialised from the saved one each time; nothing is sent until Save, which sends one `setPortraitFrame`
 * (with an optimistic update). Saving the arch's own zoom-1 framing (after Reset) clears the frame instead.
 */
export function PortraitFrameEditor({
  campaignId,
  characterId,
  name,
  src,
  saved,
  fallbackPosition,
  natural,
  onDone,
}: {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  name: string;
  src: string;
  saved: PortraitFrame | undefined;
  fallbackPosition: string;
  natural: Size | null;
  onDone: () => void;
}) {
  const plain = portraitFrameFromPosition(fallbackPosition);
  const [frame, setFrame] = useState<PortraitFrame>(() => (saved ? clampPortraitFrame(saved) : plain));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; from: PortraitFrame } | null>(null);
  const hintId = useId();
  const zoomId = useId();
  const save = useMutation(api.characters.setPortraitFrame).withOptimisticUpdate((store, args) =>
    framedLocally(store, campaignId, args.characterId, args.frame),
  );

  const measure = (el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const size = { width: box.width, height: box.height };
    return { size, overflow: coverOverflow(size, natural) };
  };

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      await save({ characterId, frame: samePortraitFrame(frame, plain) ? null : clampPortraitFrame(frame) });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="pf-editor">
      <button
        type="button"
        className="pf-preview"
        aria-label={`Move the picture of ${name}`}
        aria-describedby={hintId}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, from: frame };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.pointerId !== e.pointerId) return;
          const { size, overflow } = measure(e.currentTarget);
          setFrame(dragPortraitFrame(d.from, { dx: e.clientX - d.x, dy: e.clientY - d.y }, size, overflow));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(e) => {
          const next = nudgePortraitFrame(frame, e.key, e.shiftKey);
          if (!next) return;
          e.preventDefault();
          setFrame(next);
        }}
      >
        <PortraitLayer src={src} frame={frame} fallbackPosition={fallbackPosition} className="pf-preview-art" aria-hidden />
      </button>
      <p id={hintId} className="pf-hint">
        Drag the picture, or use the arrow keys, to choose what shows.
      </p>
      <div className="pf-zoom">
        <label htmlFor={zoomId}>Zoom</label>
        <input
          id={zoomId}
          type="range"
          min={PORTRAIT_ZOOM_MIN}
          max={PORTRAIT_ZOOM_MAX}
          step={PORTRAIT_ZOOM_STEP}
          value={frame.zoom}
          aria-valuetext={`${frame.zoom.toFixed(2)}x`}
          onChange={(e) => setFrame((f) => clampPortraitFrame({ ...f, zoom: Number(e.target.value) }))}
        />
        <output htmlFor={zoomId} className="pf-zoom-value">
          {frame.zoom.toFixed(2)}x
        </output>
      </div>
      {error ? (
        <p role="alert" className="pf-error">
          {error}
        </p>
      ) : null}
      <div className="pf-actions">
        <BrandButton variant="neutral" onClick={() => setFrame(plain)} disabled={busy}>
          Reset
        </BrandButton>
        <BrandButton variant="cancel" onClick={onDone} disabled={busy}>
          Cancel
        </BrandButton>
        <BrandButton variant="confirm" onClick={() => void onSave()} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </BrandButton>
      </div>
    </div>
  );
}
