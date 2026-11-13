"use client";

import { useMutation, useQuery } from "convex/react";
import { Camera } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { UploadNotice } from "@/components/uploads/upload-notice";
import { errorMessage } from "@/lib/convex-errors";
import { assetBackground } from "@/lib/design-assets";
import { portraitFrameStyle } from "@/lib/party/portrait-frame";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../convex/characters";

import { fitWithin, portraitSource } from "./portrait-source";

/** Long side of an uploaded portrait, in px: sharp on a 4K screen (plan sharp-4k, HD4; was 1024). */
export const PORTRAIT_MAX_SIDE = 2048;
/** The server's cap (`MAX_PORTRAIT_BYTES` in convex/characters.ts), mirrored here because that module is server-only. */
const PORTRAIT_MAX_BYTES = 3 * 1024 * 1024;
/** JPEG qualities tried in turn until the image fits its byte cap; even pure noise at 2560 x 2560 fits 3 MB at 0.6. */
export const JPEG_QUALITIES = [0.86, 0.8, 0.72, 0.6] as const;

/** What the portrait reads: the id, the sheet fields `portraitSource` uses, and the resolved upload URL when known. */
type PortraitCharacter = Pick<CharacterView, "_id"> & {
  sheet: Pick<CharacterView["sheet"], "portrait" | "portraitFrame" | "subclassId" | "ancestry" | "name" | "classId">;
  portraitUrl?: string | null;
};

/**
 * A character's portrait: their uploaded image, else the chosen design art,
 * else the default art for their subclass or ancestry, else their initial.
 * `size` in px draws the Hub's rounded square; "banner" draws the roster's
 * full-width 220px face with a fade into the card.
 */
export function CharacterPortrait({
  character,
  size,
  className,
  fallback,
}: {
  character: PortraitCharacter;
  size: number | "banner";
  className?: string;
  /** Background behind the initial (the roster uses the class banner). */
  fallback?: string;
}) {
  const source = portraitSource(character.sheet);
  // The list query already resolves uploaded portraits; fall back to a lookup for other callers.
  const preloaded = character.portraitUrl;
  const fetched = useQuery(
    api.charactersReads.portraitUrl,
    source.kind === "upload" && preloaded === undefined ? { characterId: character._id } : "skip",
  );
  const uploaded = preloaded ?? fetched;

  let image: CSSProperties | null = null;
  if (source.kind === "upload" && uploaded) image = { backgroundImage: `url(${uploaded})`, backgroundPosition: "center 30%" };
  if (source.kind === "asset") {
    const bg = assetBackground(source.asset);
    if (bg !== "none") image = { backgroundImage: bg, backgroundPosition: source.position };
  }
  const letter = source.kind === "initial" || !image ? (character.sheet.name || "?").charAt(0).toUpperCase() : "";
  // The saved close-up (plan portrait-frame, PZ2): the picture moves to an inner layer drawn through PZ1's style helper,
  // and the portrait clips it. No frame: the portrait carries the picture itself, exactly as before.
  const frame = image ? character.sheet.portraitFrame : undefined;
  const layer = frame && image ? (
    <span
      className="pointer-events-none absolute inset-0 bg-cover bg-no-repeat"
      style={{ backgroundImage: image.backgroundImage, ...portraitFrameStyle(frame, String(image.backgroundPosition)) }}
      data-testid="character-portrait-layer"
    />
  ) : null;

  if (size === "banner") {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "relative flex h-[220px] items-center justify-center bg-[#1b282d] bg-cover bg-no-repeat",
          "after:absolute after:inset-x-0 after:bottom-0 after:h-[70px] after:bg-gradient-to-t after:from-[#141e22] after:to-[rgb(20_30_34/0)]",
          layer && "overflow-hidden",
          className,
        )}
        style={layer ? undefined : (image ?? (fallback ? { background: `linear-gradient(rgba(10, 16, 18, 0.5), rgba(10, 16, 18, 0.5)), ${fallback}` } : undefined))}
      >
        {layer}
        {letter ? <span className="font-display text-[72px] font-black text-[rgb(246_234_210/0.35)]">{letter}</span> : null}
      </div>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex flex-none items-center justify-center rounded-[14px] bg-[#1f2d32] bg-cover bg-no-repeat font-display font-bold text-[#c8d3d0]",
        image ? "border-2 border-[#4a5f66]" : "border border-dashed border-[#3a4d54]",
        layer && "relative overflow-hidden",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34), ...(layer ? null : image) }}
    >
      {layer ?? letter}
    </span>
  );
}

/**
 * Encodes the canvas as JPEG at the first quality in `JPEG_QUALITIES` whose blob fits `maxBytes`.
 * When none fits, returns the last (smallest) try and lets the server's check turn it down.
 */
export async function encodeJpegWithin(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  let blob: Blob | undefined;
  for (const quality of JPEG_QUALITIES) {
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image."))), "image/jpeg", quality),
    );
    if (blob.size <= maxBytes) return blob;
  }
  if (!blob) throw new Error("Couldn't encode the image.");
  return blob;
}

/** Draws the file onto a canvas no larger than `PORTRAIT_MAX_SIDE` and re-encodes it as JPEG within the byte cap. */
export async function shrinkPortrait(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, PORTRAIT_MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize images.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return encodeJpegWithin(canvas, PORTRAIT_MAX_BYTES);
}

/** "Upload portrait" for the character's owner and the GM; resized in the browser before upload. */
export function PortraitUpload({
  character,
  className,
}: {
  character: Pick<CharacterView, "_id" | "canEdit" | "sheet">;
  className?: string;
}) {
  const uploadUrl = useMutation(api.characters.portraitUploadUrl);
  const attachPortrait = useMutation(api.characters.attachPortrait);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!character.canEdit) return null;
  const name = character.sheet.name;

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    setBusy(true);
    try {
      const blob = await shrinkPortrait(file);
      const url = await uploadUrl({ characterId: character._id });
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!response.ok) throw new Error("The upload failed. Try again.");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      const { error: rejected } = await attachPortrait({ characterId: character._id, storageId });
      if (rejected) setError(rejected);
    } catch (e) {
      setError(e instanceof Error && !("data" in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <span className={cn("inline-flex flex-col gap-1", className)}>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <BrandButton variant="neutral" size="sm" disabled={busy} onClick={() => input.current?.click()} aria-label={`Upload a portrait for ${name}`}>
        <Camera aria-hidden="true" />
        {busy ? "Uploading…" : character.sheet.portrait ? "Change portrait" : "Add portrait"}
      </BrandButton>
      <span role="status" aria-live="polite" className="text-[13px] text-danger empty:hidden">
        {error}
      </span>
      <UploadNotice kind="portrait" scope={character._id} />
    </span>
  );
}
