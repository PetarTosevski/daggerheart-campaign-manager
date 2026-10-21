"use client";

import "./packs.css";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useId, useState } from "react";

import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import { MAX_PACK_NAME, MAX_SPRITE_PACKS } from "../../../../convex/lib/validators/spritePacks";
import { packsHref, type PacksLinkProps, type PacksScreenProps } from "../slots";
import { cleanName } from "./labels";
import { PackCard, SettingSelect } from "./pack-card";
import { usePackMutations } from "./use-packs";

/**
 * Packs slot (sprite packs P8): the link to the GM's sprite packs screen and the screen itself. The GM creates a
 * pack (a setting of its own or added to a built-in setting, Q3), drops a sheet or single sprites, sees them cut in
 * the browser (D9), labels and uploads the chosen ones, and edits or deletes them later. Export names and props
 * follow src/components/combat-map/slots.ts; styles: combat-map.css (`cm-*`) plus the colocated packs.css.
 */

export function PacksLink({ campaignId }: PacksLinkProps) {
  return (
    <Link className="cm-btn" href={packsHref(campaignId)}>
      Sprite packs
    </Link>
  );
}

export function PacksScreen({ campaignId }: PacksScreenProps) {
  const packs = useQuery(api.spritePacks.packs, { campaignId });
  const mutations = usePackMutations(campaignId);

  if (packs === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading sprite packs…
      </p>
    );
  }
  return (
    <div className="cm-pk">
      <NewPack campaignId={campaignId} full={packs.length >= MAX_SPRITE_PACKS} />
      {packs.length === 0 ? (
        <section className="cm-card" aria-labelledby="cm-packs-empty-h">
          <h2 id="cm-packs-empty-h" className="cm-lbl">
            Your packs
          </h2>
          <p className="cm-muted cm-m0">No packs yet. The built-in packs are always available; make a pack to add your own sprite sheets or single sprites.</p>
        </section>
      ) : (
        packs.map((pack) => <PackCard key={pack._id} campaignId={campaignId} pack={pack} mutations={mutations} />)
      )}
    </div>
  );
}

function NewPack({ campaignId, full }: { campaignId: PacksScreenProps["campaignId"]; full: boolean }) {
  const nameId = useId();
  const settingId = useId();
  const [name, setName] = useState("");
  const [ext, setExt] = useState<string | null>(null);
  const create = useIntent(api.spritePacks.createPack);
  const clean = cleanName(name, MAX_PACK_NAME);

  async function submit() {
    if (clean === null) return;
    const result = await create.fire({ campaignId, name: clean, ...(ext === null ? {} : { extends: ext }) });
    if (result) {
      setName("");
      setExt(null);
    }
  }

  return (
    <section className="cm-card" aria-labelledby="cm-pk-new-h">
      <h2 id="cm-pk-new-h" className="cm-h">
        New pack
      </h2>
      <form
        className="cm-pk-packrow"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className="cm-pk-field">
          <label htmlFor={nameId} className="cm-pk-flabel">
            Pack name
          </label>
          <input id={nameId} className="cm-in" value={name} maxLength={MAX_PACK_NAME} placeholder="Moorland ruins" onChange={(e) => setName(e.target.value)} />
        </span>
        <span className="cm-pk-field">
          <label htmlFor={settingId} className="cm-pk-flabel">
            Setting
          </label>
          <SettingSelect id={settingId} value={ext} onChange={setExt} />
        </span>
        <button type="submit" className="cm-btn" disabled={clean === null || create.pending || full}>
          {create.pending ? "Creating…" : "Create pack"}
        </button>
      </form>
      {full ? <p className="cm-muted cm-m0">This campaign has {MAX_SPRITE_PACKS} packs, the most it can hold. Delete one to make another.</p> : null}
      {create.error ? (
        <p role="alert" className="cm-pk-err">
          {create.error}
        </p>
      ) : null}
    </section>
  );
}
