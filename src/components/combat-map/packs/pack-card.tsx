"use client";

import { useEffect, useId, useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { SETTINGS } from "@/lib/sprite-packs/settings";

import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_PACK_NAME, MAX_PACK_SPRITES, MAX_SPRITE_NAME } from "../../../../convex/lib/validators/spritePacks";
import type { PackRow, PackSpriteRow, SpritePatch } from "../../../../convex/spritePacks";
import { BlurText, SpriteFields } from "./fields";
import { Uploader } from "./uploader";
import type { usePackMutations } from "./use-packs";

/** How long a first "Delete" click waits for the confirming second click (as the maps list: 3 s). */
const CONFIRM_MS = 3000;

type Mutations = ReturnType<typeof usePackMutations>;

/** A two-click delete button: the first click asks, the second (within 3 s) deletes. */
function useConfirm(onConfirm: () => void) {
  const [asking, setAsking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function click() {
    if (timer.current) clearTimeout(timer.current);
    if (!asking) {
      setAsking(true);
      timer.current = setTimeout(() => setAsking(false), CONFIRM_MS);
      return;
    }
    setAsking(false);
    onConfirm();
  }
  return { asking, click };
}

/** The Setting options of a pack (Q3): a setting of its own, or added to one built-in setting. */
export function SettingSelect({ value, onChange, id }: { value: string | null; onChange: (value: string | null) => void; id: string }) {
  return (
    <select id={id} className="cm-in cm-pk-select" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
      <option value="">New setting</option>
      {SETTINGS.map((s) => (
        <option key={s.id} value={s.id}>
          Add to {s.label}
        </option>
      ))}
    </select>
  );
}

/** One pack: name, setting, delete, "Add sprites" and its saved sprites (each label saved on change, optimistic). */
export function PackCard({ campaignId, pack, mutations }: { campaignId: Id<"campaigns">; pack: PackRow; mutations: Mutations }) {
  const headingId = useId();
  const settingId = useId();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(pack.sprites.length === 0);
  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e: unknown) => setError(errorMessage(e)));
  };
  const remove = useConfirm(() => run(mutations.deletePack({ campaignId, packId: pack._id })));

  return (
    <section className="cm-card cm-pk-pack" aria-labelledby={headingId}>
      <div className="cm-row cm-between">
        <h2 id={headingId} className="cm-h">
          {pack.name}
        </h2>
        <span className="cm-muted">
          {pack.sprites.length} / {MAX_PACK_SPRITES} sprites
        </span>
      </div>
      <div className="cm-pk-packrow">
        <BlurText label="Pack name" value={pack.name} maxLength={MAX_PACK_NAME} onCommit={(name) => run(mutations.renamePack({ campaignId, packId: pack._id, name }))} />
        <span className="cm-pk-field">
          <label htmlFor={settingId} className="cm-pk-flabel">
            Setting
          </label>
          <SettingSelect
            id={settingId}
            value={pack.extends?.id ?? null}
            onChange={(ext) => run(mutations.setPackExtends({ campaignId, packId: pack._id, extends: ext }))}
          />
        </span>
        <button type="button" className="cm-btn cm-danger cm-pk-del" onClick={remove.click}>
          {remove.asking ? "Confirm delete" : "Delete pack"}
        </button>
      </div>
      {remove.asking ? (
        <p className="cm-muted cm-m0" role="status">
          Deletes the pack and its {pack.sprites.length} sprites. Map objects that use them go back to their Classic look.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="cm-pk-err">
          {error}
        </p>
      ) : null}

      <div className="cm-row">
        <button type="button" className="cm-btn" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          {adding ? "Hide upload" : "＋ Add sprites"}
        </button>
      </div>
      {adding ? <Uploader campaignId={campaignId} pack={pack} /> : null}

      {pack.sprites.length > 0 ? (
        <ol className="cm-pk-list" aria-label={`Sprites in ${pack.name}`}>
          {pack.sprites.map((sprite, i) => (
            <SpriteRow
              key={sprite._id}
              campaignId={campaignId}
              sprite={sprite}
              first={i === 0}
              last={i === pack.sprites.length - 1}
              mutations={mutations}
              onError={setError}
            />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function SpriteRow({
  campaignId,
  sprite,
  first,
  last,
  mutations,
  onError,
}: {
  campaignId: Id<"campaigns">;
  sprite: PackSpriteRow;
  first: boolean;
  last: boolean;
  mutations: Mutations;
  onError: (message: string | null) => void;
}) {
  const run = (p: Promise<unknown>) => {
    onError(null);
    p.catch((e: unknown) => onError(errorMessage(e)));
  };
  const save = (patch: SpritePatch) => run(mutations.updateSprite({ campaignId, spriteId: sprite._id, patch }));
  const remove = useConfirm(() => run(mutations.removeSprite({ campaignId, spriteId: sprite._id })));
  return (
    <li className="cm-pk-sprite" aria-label={sprite.name}>
      <div className="cm-pk-cut-head">
        {sprite.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Convex storage URL (the GM's upload), not a static asset
          <img className="cm-pk-thumb" src={sprite.url} alt={sprite.name} width={72} height={72} loading="lazy" decoding="async" />
        ) : (
          <span className="cm-pk-thumb cm-pk-thumb-missing" aria-hidden="true" />
        )}
        <BlurText className="cm-pk-name" label="Name" value={sprite.name} maxLength={MAX_SPRITE_NAME} onCommit={(name) => save({ name })} />
      </div>
      <SpriteFields values={sprite} onChange={save} />
      <div className="cm-row">
        <button type="button" className="cm-btn cm-sm cm-pk-move" disabled={first} aria-label={`Move ${sprite.name} up`} onClick={() => run(mutations.reorderSprite({ campaignId, spriteId: sprite._id, direction: "up" }))}>
          ↑
        </button>
        <button type="button" className="cm-btn cm-sm cm-pk-move" disabled={last} aria-label={`Move ${sprite.name} down`} onClick={() => run(mutations.reorderSprite({ campaignId, spriteId: sprite._id, direction: "down" }))}>
          ↓
        </button>
        <button type="button" className="cm-btn cm-sm cm-danger" onClick={remove.click}>
          {remove.asking ? "Confirm delete" : "Delete"}
        </button>
      </div>
    </li>
  );
}
