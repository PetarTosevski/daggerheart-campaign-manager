"use client";

import { useState } from "react";

import { SKYSHARD_IDEAS, type CastleHighState } from "@/lib/frames/extras/castle-high";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BTN, ErrorLine, ExtraCard, Field, INPUT, NOTE } from "./ui";

/** Castle High: the student's skyshard artifact (Hope & Fear p.125). */
export function CastleHighPanel({ characterId, state, canEdit }: { characterId: Id<"characters">; state: CastleHighState; canEdit: boolean }) {
  const save = useIntent(api.characterExtras.saveSkyshard);
  const [name, setName] = useState(state.skyshard.name);
  const [description, setDescription] = useState(state.skyshard.description);
  const dirty = name !== state.skyshard.name || description !== state.skyshard.description;

  return (
    <ExtraCard title="Skyshard Artifact" subtitle="An object holding a skyshard, attuned to grant its bearer controllable flight.">
      <Field label="Artifact">
        <input className={INPUT} value={name} disabled={!canEdit} maxLength={80} placeholder="A broom, winged sneakers…" onChange={(e) => setName(e.target.value)} list="skyshard-ideas" />
      </Field>
      <datalist id="skyshard-ideas">
        {SKYSHARD_IDEAS.map((idea) => (
          <option key={idea} value={idea} />
        ))}
      </datalist>
      <Field label="Description">
        <textarea
          className={`${INPUT} min-h-20 py-2`}
          value={description}
          disabled={!canEdit}
          maxLength={2000}
          placeholder="How did you acquire it? What does it look like?"
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {canEdit ? (
        <button type="button" className={BTN} disabled={!dirty || save.pending} onClick={() => void save.fire({ characterId, skyshard: { name, description } })}>
          Save skyshard
        </button>
      ) : !name && !description ? (
        <p className={NOTE}>No skyshard recorded yet.</p>
      ) : null}
      <ErrorLine error={save.error} />
    </ExtraCard>
  );
}
