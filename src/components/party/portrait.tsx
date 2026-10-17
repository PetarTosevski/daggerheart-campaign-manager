"use client";

import { useMutation, useQuery } from "convex/react";
import { Camera } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { assetBackground } from "@/lib/design-assets";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../convex/characters";

import { fitWithin, portraitSource } from "./party-display";

const MAX_SIDE = 1024;

type PortraitCharacter = Pick<CharacterView, "_id" | "sheet">;

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
  const preloaded = "portraitUrl" in character ? (character as { portraitUrl?: string | null }).portraitUrl : undefined;
  const fetched = useQuery(
    api.characters.portraitUrl,
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

  if (size === "banner") {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "relative flex h-[220px] items-center justify-center bg-[#1b282d] bg-cover bg-no-repeat",
          "after:absolute after:inset-x-0 after:bottom-0 after:h-[70px] after:bg-gradient-to-t after:from-[#141e22] after:to-[rgb(20_30_34/0)]",
          className,
        )}
        style={image ?? (fallback ? { background: `linear-gradient(rgba(10, 16, 18, 0.5), rgba(10, 16, 18, 0.5)), ${fallback}` } : undefined)}
      >
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
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34), ...image }}
    >
      {letter}
    </span>
  );
}

/** Draws the file onto a canvas no larger than 1024px and re-encodes it as JPEG. */
async function shrinkToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize images.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the image."))), "image/jpeg", 0.86),
  );
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
      const blob = await shrinkToJpeg(file);
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
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        aria-label={`Upload a portrait for ${name}`}
        className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] hover:bg-white/5 disabled:cursor-wait disabled:opacity-50"
      >
        <Camera className="size-4" aria-hidden="true" />
        {busy ? "Uploading…" : "Portrait"}
      </button>
      <span role="status" aria-live="polite" className="text-[13px] text-danger empty:hidden">
        {error}
      </span>
    </span>
  );
}
