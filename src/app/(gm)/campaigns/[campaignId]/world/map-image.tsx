"use client";

import { useMutation } from "convex/react";
import { useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const MAX_BYTES = 8 * 1024 * 1024;

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
      reject(new Error("Couldn't read that image."));
    };
    img.src = url;
  });
}

/**
 * The GM's map image: upload one for a custom campaign (or to replace a
 * published frame's art) and set its width in km. Uploads go to Convex file
 * storage; the server checks the file and records it for this campaign.
 */
export function MapImageControl({ campaignId, hasUpload, isCustom, scaleKm }: { campaignId: Id<"campaigns">; hasUpload: boolean; isCustom: boolean; scaleKm: number }) {
  const uploadUrl = useMutation(api.maps.mapImageUploadUrl);
  const attach = useMutation(api.maps.attachMapImage);
  const remove = useMutation(api.maps.removeMapImage);
  const input = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(String(scaleKm));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setStatus(null);
    if (!file.type.startsWith("image/") || file.size > MAX_BYTES) {
      setStatus("Maps must be PNG, JPEG, WebP or GIF images of at most 8 MB.");
      return;
    }
    const km = Number(width);
    if (!Number.isFinite(km) || km < 1 || km > 100000) {
      setStatus("Enter the map's width in km (1–100,000).");
      return;
    }
    setBusy(true);
    try {
      const size = await imageSize(file);
      const url = await uploadUrl({ campaignId });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const result = await attach({ campaignId, storageId, width: size.width, height: size.height, scaleKm: km });
      setStatus(result.ok ? "Map uploaded." : result.message);
    } catch (e) {
      setStatus(e instanceof Error && !("data" in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section aria-labelledby="mapimg-h" className="flex flex-col gap-2 rounded-[14px] border border-[#253338] bg-[#141e22] p-4">
      <h2 id="mapimg-h" className="m-0 font-display text-[16px] font-bold">
        Map image
      </h2>
      <p className="m-0 text-[13px] leading-[1.45] text-[#9fb2b6]">
        {isCustom ? "Upload your campaign's map (an image up to 8 MB) and set how wide it is." : "Optionally replace the frame's map with your own image (up to 8 MB)."}
      </p>
      <label className="flex items-center gap-1.5 text-[12px] text-[#9fb2b6]">
        Width
        <input className="fld fsm w-24" type="number" min={1} step={10} value={width} onChange={(e) => setWidth(e.target.value)} aria-label="Uploaded map width in kilometres" />
        km
      </label>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="map-image-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button type="button" className="zbtn zw zgold" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Uploading…" : hasUpload ? "Replace map image" : "Upload map image"}
      </button>
      {hasUpload ? (
        <button
          type="button"
          className="mseg"
          disabled={busy}
          onClick={async () => {
            try {
              await remove({ campaignId });
              setStatus("Map image removed.");
            } catch (e) {
              setStatus(errorMessage(e));
            }
          }}
        >
          {isCustom ? "Remove map image" : "Use the frame's map"}
        </button>
      ) : null}
      <p role="status" aria-live="polite" className="m-0 text-[13px] text-[#f3dfb0]">
        {status}
      </p>
    </section>
  );
}
