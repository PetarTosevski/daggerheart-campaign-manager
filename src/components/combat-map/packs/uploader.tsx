"use client";

import { useMutation } from "convex/react";
import { useId, useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import type { RgbaImage } from "@/lib/sprite-packs/cut";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_PACK_SPRITES, MAX_SPRITE_BYTES, MAX_SPRITE_NAME, MAX_SPRITE_PX } from "../../../../convex/lib/validators/spritePacks";
import type { PackRow } from "../../../../convex/spritePacks";
import { encodeSprite, readSheet, SHEET_TYPES, SheetError, thumbnail } from "./browser-image";
import { cutImages, layoutLabel } from "./cut-files";
import { SpriteFields, type FieldChange } from "./fields";
import {
  classicAfterLight,
  cleanName,
  defaultLabels,
  SHEET_LAYOUT_INFO,
  SHEET_LAYOUTS,
  SPRITE_PX_PER_SQUARE,
  suggestClassic,
  TEXTURE_PX,
  type SheetLayout,
  type SpriteLabels,
} from "./labels";

/**
 * "Add sprites" for one pack (sprite packs P8, D9): the GM drops a sheet or single sprites, the browser cuts them
 * with the P2 core (never uploading the sheet), the GM labels each cut and uploads the chosen ones: each is
 * re-encoded (WebP, PNG fallback; at most MAX_SPRITE_PX per side) and sent through `spriteUploadUrl` and
 * `attachSprite`, which checks it again on the server (CF16). Per-row progress and errors.
 */

type Status = { state: "idle" } | { state: "uploading" } | { state: "done" } | { state: "error"; message: string };

type CutRow = {
  key: string;
  image: RgbaImage;
  thumb: string;
  labels: SpriteLabels;
  /** The GM picked the Classic look; until then it follows the suggestion. */
  classicPicked: boolean;
  selected: boolean;
  status: Status;
};

type Loaded = { image: RgbaImage; source: string };

let rowKeys = 0;

/** The longest side a cut is encoded at: 160 px per square for objects, 512 px for a texture swatch (as built in). */
function maxSide(labels: SpriteLabels): number {
  return Math.min(MAX_SPRITE_PX, labels.category === "texture" ? TEXTURE_PX : Math.max(labels.w, labels.h) * SPRITE_PX_PER_SQUARE);
}

function relabel(row: CutRow, change: FieldChange): CutRow {
  const labels: SpriteLabels = { ...row.labels, ...change } as SpriteLabels;
  if ("classicKind" in change) return { ...row, labels, classicPicked: true };
  if (!row.classicPicked) return { ...row, labels: { ...labels, classicKind: suggestClassic(labels) } };
  if ("light" in change) return { ...row, labels: { ...labels, classicKind: classicAfterLight(labels.classicKind, labels) } };
  return { ...row, labels };
}

export function Uploader({ campaignId, pack }: { campaignId: Id<"campaigns">; pack: PackRow }) {
  const input = useRef<HTMLInputElement>(null);
  const layoutId = useId();
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const [layout, setLayout] = useState<SheetLayout>("auto");
  const [rows, setRows] = useState<CutRow[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [read, setRead] = useState<string | null>(null);
  const [busy, setBusy] = useState<"cutting" | "uploading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const uploadUrl = useMutation(api.spritePacks.spriteUploadUrl);
  const attach = useMutation(api.spritePacks.attachSprite);

  async function cut(images: Loaded[], chosen: SheetLayout) {
    setBusy("cutting");
    // Let "Cutting…" paint before the (synchronous) cut runs.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    try {
      const outcomes = cutImages(images, chosen);
      const next: CutRow[] = [];
      for (const outcome of outcomes)
        for (const piece of outcome.pieces) {
          const labels = defaultLabels(outcome.layout, next.length);
          next.push({ key: `cut-${++rowKeys}`, image: piece.image, thumb: thumbnail(piece.image), labels, classicPicked: false, selected: true, status: { state: "idle" } });
        }
      setRows(next);
      setNotes(outcomes.flatMap((o) => o.notes));
      setRead(chosen === "auto" ? [...new Set(outcomes.map((o) => layoutLabel(o.layout)))].join(", ") : null);
    } finally {
      setBusy(null);
    }
  }

  async function addFiles(files: File[]) {
    setError(null);
    if (files.length === 0) return;
    const images: Loaded[] = [];
    try {
      for (const file of files) images.push({ image: await readSheet(file), source: file.name });
    } catch (e) {
      setError(e instanceof SheetError ? e.message : "Couldn’t read that image.");
      return;
    }
    setLoaded(images);
    await cut(images, layout);
  }

  function chooseLayout(next: SheetLayout) {
    setLayout(next);
    if (loaded.length > 0) void cut(loaded, next);
  }

  function update(key: string, change: (row: CutRow) => CutRow) {
    setRows((current) => current.map((row) => (row.key === key ? change(row) : row)));
  }

  const chosen = rows.filter((r) => r.selected && r.status.state !== "done");
  const room = MAX_PACK_SPRITES - pack.sprites.length;

  async function uploadSelected() {
    setError(null);
    if (chosen.length > room) {
      setError(`This pack has room for ${room} more sprite${room === 1 ? "" : "s"}; untick ${chosen.length - room}.`);
      return;
    }
    const named = chosen.find((r) => cleanName(r.labels.name, MAX_SPRITE_NAME) === null);
    if (named) {
      setError(`Every sprite needs a name of 1 to ${MAX_SPRITE_NAME} characters.`);
      return;
    }
    setBusy("uploading");
    try {
      for (const row of chosen) {
        update(row.key, (r) => ({ ...r, status: { state: "uploading" } }));
        try {
          const { blob, px } = await encodeSprite(row.image, maxSide(row.labels), MAX_SPRITE_BYTES);
          const url = await uploadUrl({ campaignId });
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
          if (!res.ok) throw new SheetError("The upload failed. Try again.");
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          const { name, terrain, ...labels } = row.labels;
          const texture = labels.category === "texture";
          const result = await attach({
            campaignId,
            packId: pack._id,
            storageId,
            ...labels,
            name: name.trim(),
            footprint: labels.w === labels.h ? "circle" : "rect",
            ...(texture ? { terrain, rotatable: true } : {}),
            px,
          });
          update(row.key, (r) => ({ ...r, selected: !result.ok, status: result.ok ? { state: "done" } : { state: "error", message: result.message } }));
        } catch (e) {
          const message = e instanceof SheetError ? e.message : errorMessage(e);
          update(row.key, (r) => ({ ...r, status: { state: "error", message } }));
        }
      }
    } finally {
      setBusy(null);
    }
  }

  function clear() {
    setLoaded([]);
    setRows([]);
    setNotes([]);
    setRead(null);
    setError(null);
  }

  const done = rows.filter((r) => r.status.state === "done").length;

  return (
    <section className="cm-pk-upload" aria-label={`Add sprites to ${pack.name}`}>
      <div
        className={`cm-pk-drop${dragging ? " cm-pk-drop-on" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        <p className="cm-muted cm-m0">Drop a sprite sheet or single sprites here. They are cut in your browser; only the sprites you pick are uploaded.</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={SHEET_TYPES.join(",")}
          className="cm-pk-file"
          tabIndex={-1}
          aria-hidden="true"
          data-testid={`sprite-file-${pack._id}`}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void addFiles(files);
          }}
        />
        <button type="button" className="cm-btn" disabled={busy !== null} onClick={() => input.current?.click()}>
          Choose images…
        </button>
      </div>

      <div className="cm-pk-layout" role="group" aria-labelledby={layoutId}>
        <span id={layoutId} className="cm-lbl">
          Sheet layout
        </span>
        <div className="cm-pk-seg">
          {SHEET_LAYOUTS.map((l) => (
            <button key={l} type="button" className="cm-btn cm-sm" aria-pressed={layout === l} disabled={busy !== null} onClick={() => chooseLayout(l)}>
              {SHEET_LAYOUT_INFO[l].label}
            </button>
          ))}
        </div>
      </div>

      {busy === "cutting" ? (
        <p role="status" className="cm-muted">
          Cutting…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="cm-pk-err">
          {error}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="cm-row cm-between">
            <p className="cm-muted cm-m0" aria-live="polite">
              {rows.length} cut{rows.length === 1 ? "" : "s"}
              {read ? ` · read as ${read}` : ""}
              {done > 0 ? ` · ${done} uploaded` : ""}
            </p>
            <div className="cm-row">
              <button type="button" className="cm-btn cm-sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, selected: r.status.state !== "done" })))}>
                Select all
              </button>
              <button type="button" className="cm-btn cm-sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, selected: false })))}>
                Select none
              </button>
            </div>
          </div>
          {notes.length > 0 ? (
            <ul className="cm-pk-notes" aria-label="Cut notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <ol className="cm-pk-grid" aria-label="Cut sprites">
            {rows.map((row, i) => (
              <CutCard key={row.key} row={row} index={i} onChange={(change) => update(row.key, change)} />
            ))}
          </ol>
          <div className="cm-row">
            <button type="button" className="cm-go" disabled={busy !== null || chosen.length === 0} onClick={() => void uploadSelected()}>
              {busy === "uploading" ? "Uploading…" : `Upload selected (${chosen.length})`}
            </button>
            <button type="button" className="cm-btn" disabled={busy !== null} onClick={clear}>
              Clear
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function CutCard({ row, index, onChange }: { row: CutRow; index: number; onChange: (change: (row: CutRow) => CutRow) => void }) {
  const pickId = useId();
  const nameId = useId();
  const done = row.status.state === "done";
  return (
    <li className={`cm-pk-cut${row.selected ? " cm-pk-cut-on" : ""}`} aria-label={`Cut ${index + 1}: ${row.labels.name}`}>
      <div className="cm-pk-cut-head">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local canvas preview (data URL), never a served asset */}
        <img className="cm-pk-thumb" src={row.thumb} alt={`Cut ${index + 1}`} width={72} height={72} />
        <span className="cm-pk-field cm-pk-check">
          <input id={pickId} type="checkbox" checked={row.selected} disabled={done} onChange={(e) => onChange((r) => ({ ...r, selected: e.target.checked }))} />
          <label htmlFor={pickId}>Upload</label>
        </span>
        <span className={`cm-pk-status cm-pk-status-${row.status.state}`} role={row.status.state === "error" ? "alert" : undefined}>
          {row.status.state === "uploading" ? "Uploading…" : done ? "Uploaded" : row.status.state === "error" ? row.status.message : ""}
        </span>
      </div>
      <span className="cm-pk-field">
        <label htmlFor={nameId} className="cm-pk-flabel">
          Name
        </label>
        <input
          id={nameId}
          className="cm-in"
          value={row.labels.name}
          maxLength={MAX_SPRITE_NAME}
          disabled={done}
          onChange={(e) => {
            const name = e.target.value;
            onChange((r) => ({ ...r, labels: { ...r.labels, name } }));
          }}
        />
      </span>
      <fieldset className="cm-pk-fs" disabled={done}>
        <legend className="cm-pk-sr">Labels of cut {index + 1}</legend>
        <SpriteFields values={row.labels} onChange={(change) => onChange((r) => relabel(r, change))} />
      </fieldset>
    </li>
  );
}
