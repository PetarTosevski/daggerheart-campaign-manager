"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRef, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { photoImportMessages } from "@/lib/errors/photoImport";
import { MAX_PHOTOS, type ImportDraft, type PhotoReadResult } from "@/lib/import/draft";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

import { ReviewForm, type Owner } from "./review";

/** Photos are shrunk to this many pixels on the long side: plenty to read handwriting, far under the 5 MB limit. */
const MAX_SIDE = 2000;

async function shrinkToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize images.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the image."))), "image/jpeg", 0.88),
  );
}

type Step = { kind: "pick" } | { kind: "reading"; note: string } | { kind: "review"; result: PhotoReadResult } | { kind: "saved"; characterId: Id<"characters">; name: string };

/** Pick up to four photos, read them with Claude, review the draft, save. */
export function ImportFlow({ campaignId, hopeAndFear, onClose }: { campaignId: Id<"campaigns">; hopeAndFear: boolean; onClose: () => void }) {
  const uploadUrl = useMutation(api.photoImport.uploadUrl);
  const claim = useMutation(api.photoImport.claim);
  const discard = useMutation(api.photoImport.discard);
  const read = useAction(api.photoImport.read);
  const create = useIntent(api.photoImport.create);
  const roster = useQuery(api.members.roster, { campaignId });
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);

  const owners: Owner[] = roster
    ? [{ userId: roster.gm.userId, name: `${roster.gm.name} (GM)` }, ...roster.players.map((p) => ({ userId: p.userId, name: p.name }))]
    : [];

  async function readPhotos() {
    setError(null);
    try {
      // Leftovers from an earlier, interrupted import would count against the four.
      await discard({ campaignId });
      for (const [i, file] of files.entries()) {
        setStep({ kind: "reading", note: `Uploading photo ${i + 1} of ${files.length}…` });
        const blob = await shrinkToJpeg(file);
        const url = await uploadUrl({ campaignId });
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
        if (!response.ok) throw new Error("An upload failed. Try again.");
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
        const claimed = await claim({ campaignId, storageId });
        if (!claimed.ok) throw new Error(photoImportMessages[claimed.code]);
      }
      setStep({ kind: "reading", note: "Claude is reading the sheet… this can take a minute." });
      setStep({ kind: "review", result: await read({ campaignId }) });
    } catch (e) {
      setError(e instanceof Error && !("data" in e) ? e.message : errorMessage(e));
      setStep({ kind: "pick" });
      await discard({ campaignId }).catch(() => undefined);
    }
  }

  async function save(draft: ImportDraft, ownerId: Id<"users">) {
    const result = await create.fire({ campaignId, draft, ownerId });
    if (result) setStep({ kind: "saved", characterId: result.characterId, name: draft.name });
  }

  if (step.kind === "saved") {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="m-0 text-[16px]">
          {step.name} joined the party.
        </p>
        <div className="flex gap-3">
          <Link href={`/campaigns/${campaignId}/party/${step.characterId}`} className="text-brand underline">
            Open {step.name}&apos;s sheet
          </Link>
          <BrandButton onClick={onClose}>Close</BrandButton>
        </div>
      </div>
    );
  }

  if (step.kind === "review") {
    return (
      <ReviewForm
        initial={step.result.draft}
        unreadable={step.result.unreadable}
        unmatched={step.result.unmatched}
        hopeAndFear={hopeAndFear}
        owners={owners}
        defaultOwner={roster?.gm.userId}
        saving={create.pending}
        error={create.error}
        onSave={(draft, ownerId) => void save(draft, ownerId)}
      />
    );
  }

  const busy = step.kind === "reading";
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[15px] text-[#c9d2cf]">
        Take up to {MAX_PHOTOS} clear photos of a filled-in character sheet. Claude reads them into a draft you check and edit before anything is saved; the photos are deleted
        right after reading.
      </p>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        aria-label="Sheet photos"
        className="text-[14px]"
        disabled={busy}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          setError(picked.length > MAX_PHOTOS ? `Choose at most ${MAX_PHOTOS} photos.` : null);
          setFiles(picked.slice(0, MAX_PHOTOS));
        }}
      />
      {files.length > 0 ? (
        <ul className="m-0 list-disc pl-5 text-[14px] text-[#c9d2cf]">
          {files.map((f) => (
            <li key={`${f.name}-${f.size}-${f.lastModified}`}>{f.name}</li>
          ))}
        </ul>
      ) : null}
      {busy ? (
        <p role="status" className="m-0 text-[15px]">
          {step.note}
        </p>
      ) : null}
      <p role="alert" className="m-0 text-[14px] text-danger empty:hidden">
        {error}
      </p>
      <div className="flex gap-3">
        <BrandButton variant="primary" size="lg" disabled={busy || files.length === 0} onClick={() => void readPhotos()}>
          Read photos
        </BrandButton>
        <BrandButton size="lg" disabled={busy} onClick={onClose}>
          Cancel
        </BrandButton>
      </div>
    </div>
  );
}
