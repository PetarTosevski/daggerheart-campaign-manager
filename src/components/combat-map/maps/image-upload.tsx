"use client";

import { useMutation } from "convex/react";
import { useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** The server's limit (MAX_COMBAT_IMAGE_BYTES); checked here first so a too-big file is never uploaded. */
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = "image/png,image/jpeg,image/webp,image/gif";
const REFUSED = "Map images must be PNG, JPEG, WebP or GIF files of at most 8 MB.";

function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn’t read that image."));
    };
    img.src = url;
  });
}

/**
 * Uploads a map image (R1) the way the World map does (src/app/(gm)/campaigns/[campaignId]/world/map-image.tsx):
 * an upload URL from the GM-only, rate-limited `imageUploadUrl`, the file posted to Convex storage, then
 * `attachImage`, which checks the file on the server. Returns the map id, or null with `error` set.
 */
export function useMapImageUpload(campaignId: Id<"campaigns">) {
  const uploadUrl = useMutation(api.combatMaps.imageUploadUrl);
  const attach = useMutation(api.combatMaps.attachImage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File, target: { mapId?: Id<"combatMaps">; size?: "small" | "medium" | "large" }): Promise<Id<"combatMaps"> | null> {
    setError(null);
    if (!TYPES.split(",").includes(file.type) || file.size > MAX_BYTES) {
      setError(REFUSED);
      return null;
    }
    setBusy(true);
    try {
      const size = await imageSize(file);
      const url = await uploadUrl({ campaignId });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("The upload failed. Try again.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const result = await attach({
        campaignId,
        storageId,
        width: size.width,
        height: size.height,
        ...(target.mapId ? { mapId: target.mapId } : { name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) }),
        ...(target.size ? { size: target.size } : {}),
      });
      if (!result.ok) {
        setError(result.message);
        return null;
      }
      return result.mapId;
    } catch (e) {
      setError(e instanceof Error && !("data" in e) ? e.message : errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { upload, busy, error, clearError: () => setError(null) };
}

/**
 * A button that picks a map image and uploads it: onto `mapId` (its layout becomes the image) or, without it,
 * as a new map. Also for C4's Scene card ("Use my own map image"). Reports the map id through `onDone`.
 */
export function MapImageButton({
  campaignId,
  mapId,
  size,
  label,
  className = "cm-btn",
  onDone,
}: {
  campaignId: Id<"campaigns">;
  mapId?: Id<"combatMaps">;
  size?: "small" | "medium" | "large";
  label: string;
  className?: string;
  onDone?: (mapId: Id<"combatMaps">) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { upload, busy, error } = useMapImageUpload(campaignId);
  return (
    <span className="cm-upload">
      <input
        ref={input}
        type="file"
        accept={TYPES}
        className="cm-sr"
        tabIndex={-1}
        aria-hidden="true"
        data-testid={mapId ? `map-image-input-${mapId}` : "map-image-input"}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void upload(file, { mapId, size }).then((id) => {
            if (id !== null) onDone?.(id);
          });
        }}
      />
      <button type="button" className={className} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Uploading…" : label}
      </button>
      {error ? (
        <span role="alert" className="cm-upload-err">
          {error}
        </span>
      ) : null}
    </span>
  );
}
