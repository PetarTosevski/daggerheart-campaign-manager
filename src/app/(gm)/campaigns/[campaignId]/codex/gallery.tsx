"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { encodeJpegWithin } from "@/components/party/portrait";
import { fitWithin } from "@/components/party/portrait-source";
import { UploadNotice } from "@/components/uploads/upload-notice";
import { errorMessage } from "@/lib/convex-errors";
import { MAX_CODEX_IMAGE_BYTES, maxCodexImages } from "@/lib/codex/schema";
import type { GmEntry, PlayerEntry } from "@/lib/codex/view";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

/** Long side of an uploaded Codex image, in px: sharp on a 4K screen (plan sharp-4k, HD4; was 1800). */
export const CODEX_IMAGE_MAX_SIDE = 2560;

/**
 * Draws the file onto a canvas no larger than `CODEX_IMAGE_MAX_SIDE` and re-encodes it as JPEG (the board's shrink),
 * stepping the quality down until the blob fits the server's `MAX_CODEX_IMAGE_BYTES`.
 */
export async function shrinkCodexImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, CODEX_IMAGE_MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize images.");
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return encodeJpegWithin(canvas, MAX_CODEX_IMAGE_BYTES);
}

/** An image by its page key (the GM's key is the storage id; players get an opaque index). */
type Img = { key: string; url: string | null; shown?: boolean };

/** `list` with the item `key` moved to position `toIndex`. */
function moved<T extends { key: string }>(list: T[], key: string, toIndex: number): T[] {
  const item = list.find((g) => g.key === key);
  if (!item) return list;
  const rest = list.filter((g) => g.key !== key);
  rest.splice(toIndex, 0, item);
  return rest;
}

/** The Images card: thumbnails (GM: reveal, main picture, delete, drag to reorder) and the add-images drop zone. */
export function Gallery({ entry, gm, onOpen }: { entry: GmEntry | PlayerEntry; gm: boolean; onOpen: (key: string) => void }) {
  const uploadUrl = useMutation(api.codex.imageUploadUrl);
  const attach = useMutation(api.codex.attachImage);
  const setShown = useMutation(api.codex.setImageShown);
  const setCover = useMutation(api.codex.setCover);
  const removeImage = useMutation(api.codex.removeImage);
  const moveImage = useMutation(api.codex.moveImage);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOn, setDragOn] = useState(false);
  const [confirmImg, setConfirmImg] = useState<string | null>(null);
  const entryId = entry._id as Id<"codexEntries">;
  /** The image being dragged to a new place (GM), and the tile it is over. */
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  /** A move shown at once, until the server's order arrives. */
  const [pendingMove, setPendingMove] = useState<{ key: string; toIndex: number } | null>(null);
  const stored: Img[] = entry.images;
  const images = pendingMove ? moved(stored, pendingMove.key, pendingMove.toIndex) : stored;
  const max = maxCodexImages(entry.kind);
  const full = images.length >= max;
  const name = entry.name || "this entry";

  const run = async (op: () => Promise<unknown>) => {
    setError(null);
    try {
      await op();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  async function dropOn(targetKey: string) {
    const key = dragKey;
    setDragKey(null);
    setOverKey(null);
    const toIndex = stored.findIndex((g) => g.key === targetKey);
    if (!key || key === targetKey || toIndex < 0) return;
    setPendingMove({ key, toIndex });
    await run(() => moveImage({ entryId, storageId: key, toIndex }));
    setPendingMove(null);
  }

  async function addImages(files: Iterable<File>) {
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!picked.length) return;
    const room = max - images.length;
    setError(room < picked.length ? `${entry.kind === "location" ? "A location" : "A character"} holds at most ${max} images.` : null);
    setBusy(true);
    try {
      for (const file of picked.slice(0, Math.max(0, room))) {
        const blob = await shrinkCodexImage(file);
        const url = await uploadUrl({ entryId });
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
        if (!response.ok) throw new Error("The upload failed. Try again.");
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
        const result = await attach({ entryId, storageId });
        if (result.error) throw new Error(result.error);
      }
    } catch (e) {
      setError(e instanceof Error && !("data" in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  // Paste an image anywhere on the page to add it to the open entry (GM).
  const addRef = useRef(addImages);
  useEffect(() => {
    addRef.current = addImages;
  });
  useEffect(() => {
    if (!gm) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA/.test(target.tagName)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void addRef.current(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [gm]);

  return (
    <div className="cx-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 className="cx-h">Images</h2>
        {gm ? (
          <span className="cx-muted">
            Reveal an image to let the players see it. Revealing one also marks the entry as known. Drag an image to change the order.
          </span>
        ) : null}
      </div>
      {!gm && !images.length ? <p className="cx-muted m-0">Nothing to show yet.</p> : null}
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3"
        onDragOver={(e) => {
          if (!gm) return;
          e.preventDefault();
          // Reordering an image is not a file drop: the add tile stays unlit.
          if (!dragKey) setDragOn(true);
        }}
        onDragLeave={() => setDragOn(false)}
        onDrop={(e) => {
          if (!gm) return;
          e.preventDefault();
          setDragOn(false);
          if (dragKey) {
            // Dropped between tiles: nothing moves.
            setDragKey(null);
            setOverKey(null);
            return;
          }
          void addImages(e.dataTransfer.files);
        }}
      >
        {images.map((g) => {
          const hidden = gm && !g.shown;
          const isCover = entry.cover === g.key;
          return (
            <div
              key={g.key}
              className={cn(
                "cx-thumb",
                hidden && "hid",
                dragKey === g.key && "opacity-40",
                dragKey && dragKey !== g.key && overKey === g.key && "outline outline-2 outline-offset-2 outline-[#d9b25f]",
              )}
              draggable={gm && images.length > 1 && !pendingMove}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", name);
                setDragKey(g.key);
              }}
              onDragEnd={() => {
                setDragKey(null);
                setOverKey(null);
              }}
              onDragOver={(e) => {
                if (!dragKey) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overKey !== g.key) setOverKey(g.key);
              }}
              onDrop={(e) => {
                if (!dragKey) return;
                e.preventDefault();
                e.stopPropagation();
                void dropOn(g.key);
              }}
              style={{ ...(g.url ? { backgroundImage: `url(${g.url})` } : {}), borderColor: gm && g.shown ? "#3d7a55" : "#253338" }}
            >
              {/* The open button covers the tile; the GM's tools sit above it as siblings, so no control is nested in another. */}
              <button
                type="button"
                className="cx-thumb-open"
                onClick={() => onOpen(g.key)}
                aria-label={`Open image of ${name}${gm ? (g.shown ? " (revealed)" : " (hidden from players)") : ""}`}
              />
              {gm ? (
                <div className="cx-tools">
                  <BrandButton
                    variant="neutral"
                    size="sm"
                    className="flex-none"
                    aria-pressed={!!g.shown}
                    title={g.shown ? "Players can see this. Click to hide it." : "Hidden from players. Click to reveal it."}
                    onClick={() => void run(() => setShown({ entryId, storageId: g.key, shown: !g.shown }))}
                  >
                    {g.shown ? "👁 Revealed" : "🔒 Hidden"}
                  </BrandButton>
                  <span className="ml-auto flex gap-1">
                    {/* The cover is lit with the Hope colour set (gb-hope), not aria-pressed: picking it again does not unpick it. */}
                    <BrandButton
                      variant="neutral"
                      size="sm"
                      icon
                      className={cn(isCover && "gb-hope")}
                      title="Use as the main picture"
                      aria-label="Use as the main picture"
                      onClick={() => void run(() => setCover({ entryId, storageId: g.key }))}
                    >
                      ★
                    </BrandButton>
                    <BrandButton
                      variant="danger"
                      size="sm"
                      icon={confirmImg !== g.key}
                      title={confirmImg === g.key ? "Click again to delete this image" : "Delete image"}
                      aria-label={confirmImg === g.key ? "Click again to delete this image" : "Delete image"}
                      onClick={() => {
                        if (confirmImg !== g.key) {
                          setConfirmImg(g.key);
                          return;
                        }
                        setConfirmImg(null);
                        void run(() => removeImage({ entryId, storageId: g.key }));
                      }}
                    >
                      {confirmImg === g.key ? "Sure?" : "×"}
                    </BrandButton>
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
        {gm ? (
          <button type="button" className={cn("cx-drop", dragOn && "over")} disabled={busy || full} onClick={() => input.current?.click()}>
            <span className="text-[28px] leading-none">＋</span>
            <span>{full ? `At most ${max} images` : "Add images: click, drop files here, or paste"}</span>
          </button>
        ) : null}
      </div>
      {gm ? (
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            if (e.target.files?.length) void addImages(e.target.files);
          }}
        />
      ) : null}
      {busy ? (
        <div className="cx-muted" role="status">
          Adding images…
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="text-[14px] text-[#ffb4a8]">
          {error}
        </div>
      ) : null}
      {gm ? <UploadNotice kind="codexImage" scope={entryId} /> : null}
    </div>
  );
}

export type LightboxState = { entryId: string; key: string };

/** Full-screen image viewer: click or Esc to close, arrows to step through the entry's images. */
export function Lightbox({
  title,
  images,
  state,
  onChange,
  onClose,
}: {
  title: string;
  images: Img[];
  state: LightboxState;
  onChange: (next: LightboxState) => void;
  onClose: () => void;
}) {
  const index = Math.max(0, images.findIndex((g) => g.key === state.key));
  const step = (d: number) => {
    if (!images.length) return;
    const next = images[(index + d + images.length) % images.length];
    onChange({ entryId: state.entryId, key: next.key });
  };
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") stepRef.current(1);
      if (e.key === "ArrowLeft") stepRef.current(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = images[index];
  if (!current) return null;
  const single = images.length < 2;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-[100] box-border flex cursor-zoom-out flex-col items-center justify-center gap-3.5 bg-[rgb(3_6_7/0.94)] p-4 sm:p-7"
    >
      {current.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- Convex storage URLs, already resized on upload
        <img
          src={current.url}
          alt={title}
          className="max-h-[calc(100_*_var(--vh)_-_140px)] max-w-full rounded-[10px] object-contain shadow-[0_20px_60px_rgba(0,0,0,0.7)]"
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-3.5 text-[#e6ecea]" onClick={(e) => e.stopPropagation()}>
        <BrandButton variant="neutral" icon onClick={() => step(-1)} disabled={single} aria-label="Previous image">
          ‹
        </BrandButton>
        <span className="font-display text-[18px]">{title}</span>
        <span className="cx-muted">
          {index + 1} / {images.length}
        </span>
        <BrandButton variant="neutral" icon onClick={() => step(1)} disabled={single} aria-label="Next image">
          ›
        </BrandButton>
        <BrandButton variant="cancel" onClick={onClose}>
          Close · Esc
        </BrandButton>
      </div>
    </div>
  );
}
