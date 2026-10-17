"use client";

import { useState } from "react";

import { FLAVOR_DIE, FLAVOR_LABEL, FLAVORS, harvestCount, type Flavor } from "@/lib/domain/frames/beast-feast";
import { formatProfile, MAX_STRENGTH, profileOf, type BeastFeastState, type CookbookEntry, type FlavorProfile } from "@/lib/frames/extras/beast-feast";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BTN, ErrorLine, ExtraCard, Field, INPUT, LABEL, NOTE } from "./ui";

type FlavorRow = { flavor: Flavor; strength: number };
type Recipe = CookbookEntry & { canRemove: boolean };

/** Beast Feast (Core pp.277–279): carried ingredients and the party cookbook. */
export function BeastFeastPanel({
  campaignId,
  characterId,
  state,
  cookbook,
  capacity,
  canEdit,
}: {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  state: BeastFeastState;
  cookbook: Recipe[];
  capacity: number;
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <IngredientsCard characterId={characterId} state={state} capacity={capacity} canEdit={canEdit} />
      <CookbookCard campaignId={campaignId} cookbook={cookbook} ingredients={state.ingredients} />
    </div>
  );
}

function IngredientsCard({ characterId, state, capacity, canEdit }: { characterId: Id<"characters">; state: BeastFeastState; capacity: number; canEdit: boolean }) {
  const add = useIntent(api.characterExtras.addIngredient);
  const remove = useIntent(api.characterExtras.removeIngredient);
  const [name, setName] = useState("");
  const [flavors, setFlavors] = useState<FlavorRow[]>([{ flavor: "sweet", strength: 1 }]);
  const [feature, setFeature] = useState("");
  const [beastHp, setBeastHp] = useState("");
  const full = state.ingredients.length >= capacity;
  const hp = Number(beastHp);

  return (
    <ExtraCard title="Ingredients" subtitle={`Carrying ${state.ingredients.length} / ${capacity} (your highest trait).`}>
      {state.ingredients.length === 0 ? <p className={NOTE}>No ingredients.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {state.ingredients.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 text-[14px] text-[#e6ecea]">
            <strong>{i.name}</strong>
            <span className="text-[#c9d6c0]">{i.flavors.map((f) => `${FLAVOR_LABEL[f.flavor]} (${f.strength})`).join(", ")}</span>
            {i.feature ? <span className="text-[13px] text-[#f4e3bd] italic">{i.feature}</span> : null}
            {canEdit ? (
              <button type="button" className={`${BTN} ml-auto min-h-8 px-2 text-[12px]`} disabled={remove.pending} onClick={() => void remove.fire({ characterId, ingredientId: i.id })}>
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {canEdit ? (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={LABEL}>Add an ingredient</legend>
          <input className={INPUT} aria-label="Ingredient name" placeholder="Mushroom caps…" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          {flavors.map((row, k) => (
            <div key={k} className="flex gap-2">
              <select
                className={`${INPUT} flex-1`}
                aria-label={`Flavor ${k + 1}`}
                value={row.flavor}
                onChange={(e) => setFlavors(flavors.map((r, j) => (j === k ? { ...r, flavor: e.target.value as Flavor } : r)))}
              >
                {FLAVORS.map((f) => (
                  <option key={f} value={f}>
                    {FLAVOR_LABEL[f]} (d{FLAVOR_DIE[f]})
                  </option>
                ))}
              </select>
              <select
                className={`${INPUT} w-24`}
                aria-label={`Flavor ${k + 1} strength`}
                value={row.strength}
                onChange={(e) => setFlavors(flavors.map((r, j) => (j === k ? { ...r, strength: Number(e.target.value) } : r)))}
              >
                {Array.from({ length: MAX_STRENGTH }, (_, s) => (
                  <option key={s} value={s + 1}>
                    {s + 1}
                  </option>
                ))}
              </select>
              {flavors.length > 1 ? (
                <button type="button" className={BTN} aria-label={`Remove flavor ${k + 1}`} onClick={() => setFlavors(flavors.filter((_, j) => j !== k))}>
                  ✕
                </button>
              ) : null}
            </div>
          ))}
          {flavors.length < 3 ? (
            <button
              type="button"
              className={BTN}
              onClick={() => setFlavors([...flavors, { flavor: FLAVORS.find((f) => !flavors.some((r) => r.flavor === f)) ?? "weird", strength: 1 }])}
            >
              Add flavor
            </button>
          ) : null}
          <input className={INPUT} aria-label="Ingredient feature" placeholder="Feature (rare ingredients only)" maxLength={300} value={feature} onChange={(e) => setFeature(e.target.value)} />
          <button
            type="button"
            className={BTN}
            disabled={!name.trim() || full || add.pending}
            onClick={async () => {
              const ok = await add.fire({ characterId, ingredient: { name, flavors, ...(feature.trim() ? { feature } : {}) } });
              if (ok !== undefined) {
                setName("");
                setFeature("");
                setFlavors([{ flavor: "sweet", strength: 1 }]);
              }
            }}
          >
            {full ? "Hands full" : "Add ingredient"}
          </button>
        </fieldset>
      ) : null}

      <Field label="Harvest: beast's maximum HP">
        <input className={`${INPUT} w-28`} type="number" min={1} value={beastHp} onChange={(e) => setBeastHp(e.target.value)} />
      </Field>
      {beastHp && hp > 0 ? (
        <p data-testid="harvest-count" className={NOTE}>
          Yields {harvestCount(hp)} ingredient(s); the GM sets their flavors.
        </p>
      ) : null}
      <ErrorLine error={add.error ?? remove.error} />
    </ExtraCard>
  );
}

function CookbookCard({ campaignId, cookbook, ingredients }: { campaignId: Id<"campaigns">; cookbook: Recipe[]; ingredients: BeastFeastState["ingredients"] }) {
  const add = useIntent(api.characterExtras.addCookbookEntry);
  const remove = useIntent(api.characterExtras.removeCookbookEntry);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [rating, setRating] = useState("");
  const chosen = ingredients.filter((i) => picked.includes(i.id));
  const profile: FlavorProfile = profileOf(chosen);

  return (
    <ExtraCard title="Party Cookbook" subtitle="Cooking a recorded flavor profile again adds tokens equal to the party's tier.">
      {cookbook.length === 0 ? <p className={NOTE}>No recipes yet.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {cookbook.map((e) => (
          <li key={e.id} className="flex flex-col gap-0.5 rounded-lg border border-[#253338] p-2.5 text-[14px] text-[#e6ecea]">
            <div className="flex items-center gap-2">
              <strong className="text-parchment">{e.name}</strong>
              <span className="text-[13px] text-[#8fa3a8]">{formatProfile(e.profile)}</span>
              {e.mealRating !== null ? <span className="ml-auto text-[13px]">Meal Rating {e.mealRating}</span> : null}
              {e.canRemove ? (
                <button
                  type="button"
                  className={`${BTN} min-h-8 px-2 text-[12px] ${e.mealRating === null ? "ml-auto" : ""}`}
                  aria-label={`Remove ${e.name}`}
                  disabled={remove.pending}
                  onClick={() => void remove.fire({ campaignId, entryId: e.id })}
                >
                  ✕
                </button>
              ) : null}
            </div>
            {e.ingredients.length ? <span className="text-[13px] text-[#c9d6c0]">{e.ingredients.join(", ")}</span> : null}
            {e.description ? <span className="text-[13px] text-[#c9d6c0] italic">{e.description}</span> : null}
          </li>
        ))}
      </ul>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={LABEL}>Record a recipe</legend>
        <input className={INPUT} aria-label="Dish name" placeholder="Steak dinner…" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className={`${INPUT} min-h-16 py-2`} aria-label="Dish description" placeholder="How it was cooked, how it turned out" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        {ingredients.length ? (
          <div className="flex flex-wrap gap-2">
            {ingredients.map((i) => (
              <label key={i.id} className="flex items-center gap-1.5 text-[13px] text-[#e6ecea]">
                <input type="checkbox" checked={picked.includes(i.id)} onChange={() => setPicked(picked.includes(i.id) ? picked.filter((x) => x !== i.id) : [...picked, i.id])} />
                {i.name}
              </label>
            ))}
          </div>
        ) : null}
        <p className={NOTE}>Flavor profile: {formatProfile(profile)}</p>
        <Field label="Meal Rating">
          <input className={`${INPUT} w-28`} type="number" min={0} value={rating} onChange={(e) => setRating(e.target.value)} />
        </Field>
        <button
          type="button"
          className={BTN}
          disabled={!name.trim() || add.pending}
          onClick={async () => {
            const ok = await add.fire({
              campaignId,
              entry: { name, description, ingredients: chosen.map((i) => i.name), profile, mealRating: rating === "" ? null : Number(rating) },
            });
            if (ok !== undefined) {
              setName("");
              setDescription("");
              setPicked([]);
              setRating("");
            }
          }}
        >
          Add to cookbook
        </button>
        <p className={NOTE}>Spend the cooked ingredients from your list after recording the dish.</p>
      </fieldset>
      <ErrorLine error={add.error ?? remove.error} />
    </ExtraCard>
  );
}
