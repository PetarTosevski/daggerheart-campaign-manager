"use client";

import { useState } from "react";

import { Pip } from "@/components/party/sheet-ui";
import { FLAVOR_DIE, FLAVOR_LABEL, FLAVORS, harvestCount, type Flavor } from "@/lib/domain/frames/beast-feast";
import { formatProfile, MAX_STRENGTH, profileOf, type BeastFeastState, type CookbookEntry, type FlavorProfile } from "@/lib/frames/extras/beast-feast";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ALT_BTN, BTN, ErrorLine, ExtraBox, Field, INPUT, LABEL, NOTE, PlaqueBox, TEXTAREA } from "./ui";

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
    <ExtraBox frame="Beast Feast" title="Ingredients & Cookbook" subtitle="What you carry from the hunt, and the dishes the party has cooked.">
      <IngredientsCard characterId={characterId} state={state} capacity={capacity} canEdit={canEdit} />
      <CookbookCard campaignId={campaignId} cookbook={cookbook} ingredients={state.ingredients} />
    </ExtraBox>
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
    <PlaqueBox title="Ingredients">
      <div className="xs-kv">
        <span className={LABEL}>
          Carrying {state.ingredients.length} / {capacity}
        </span>
        <span role="img" aria-label={`Carrying ${state.ingredients.length} of ${capacity} ingredients`} className="xs-pips">
          {Array.from({ length: capacity }, (_, k) => (
            <Pip key={k} kind="diamond" on={k < state.ingredients.length} />
          ))}
        </span>
      </div>
      <p className={NOTE}>You can carry as many ingredients as your highest trait.</p>
      {state.ingredients.length === 0 ? <p className={NOTE}>No ingredients.</p> : null}
      <ul className="xs-list">
        {state.ingredients.map((i) => (
          <li key={i.id} className="xs-item">
            <strong className="xs-name">{i.name}</strong>
            <span className="xs-meta">{i.flavors.map((f) => `${FLAVOR_LABEL[f.flavor]} (${f.strength})`).join(", ")}</span>
            {i.feature ? <span className="italic">{i.feature}</span> : null}
            {canEdit ? (
              <button type="button" className={`${ALT_BTN} ml-auto`} disabled={remove.pending} onClick={() => void remove.fire({ characterId, ingredientId: i.id })}>
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
            <div key={k} className="xs-row">
              <select
                className={`${INPUT} xs-grow`}
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
                className={`${INPUT} xs-narrow`}
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
                <button type="button" className={ALT_BTN} aria-label={`Remove flavor ${k + 1}`} onClick={() => setFlavors(flavors.filter((_, j) => j !== k))}>
                  ✕
                </button>
              ) : null}
            </div>
          ))}
          {flavors.length < 3 ? (
            <button
              type="button"
              className={`${ALT_BTN} self-start`}
              onClick={() => setFlavors([...flavors, { flavor: FLAVORS.find((f) => !flavors.some((r) => r.flavor === f)) ?? "weird", strength: 1 }])}
            >
              Add flavor
            </button>
          ) : null}
          <input className={INPUT} aria-label="Ingredient feature" placeholder="Feature (rare ingredients only)" maxLength={300} value={feature} onChange={(e) => setFeature(e.target.value)} />
          <button
            type="button"
            className={`${BTN} self-start`}
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
        <input className={`${INPUT} xs-mid`} type="number" min={1} value={beastHp} onChange={(e) => setBeastHp(e.target.value)} />
      </Field>
      {beastHp && hp > 0 ? (
        <p data-testid="harvest-count" className={NOTE}>
          Yields {harvestCount(hp)} ingredient(s); the GM sets their flavors.
        </p>
      ) : null}
      <ErrorLine error={add.error ?? remove.error} />
    </PlaqueBox>
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
    <PlaqueBox title="Party Cookbook">
      <p className={NOTE}>Cooking a recorded flavor profile again adds tokens equal to the party’s tier.</p>
      {cookbook.length === 0 ? <p className={NOTE}>No recipes yet.</p> : null}
      <ul className="xs-list">
        {cookbook.map((e) => (
          <li key={e.id} className="xs-item col">
            <div className="xs-item-head">
              <strong className="xs-name">{e.name}</strong>
              <span className="xs-meta">{formatProfile(e.profile)}</span>
              {e.mealRating !== null ? <span className="ml-auto">Meal Rating {e.mealRating}</span> : null}
              {e.canRemove ? (
                <button
                  type="button"
                  className={`${ALT_BTN} ${e.mealRating === null ? "ml-auto" : ""}`}
                  aria-label={`Remove ${e.name}`}
                  disabled={remove.pending}
                  onClick={() => void remove.fire({ campaignId, entryId: e.id })}
                >
                  ✕
                </button>
              ) : null}
            </div>
            {e.ingredients.length ? <span className="xs-meta">{e.ingredients.join(", ")}</span> : null}
            {e.description ? <span className="italic">{e.description}</span> : null}
          </li>
        ))}
      </ul>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={LABEL}>Record a recipe</legend>
        <input className={INPUT} aria-label="Dish name" placeholder="Steak dinner…" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className={TEXTAREA} aria-label="Dish description" placeholder="How it was cooked, how it turned out" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        {ingredients.length ? (
          <div className="xs-checks">
            {ingredients.map((i) => (
              <label key={i.id} className="xs-check">
                <input type="checkbox" checked={picked.includes(i.id)} onChange={() => setPicked(picked.includes(i.id) ? picked.filter((x) => x !== i.id) : [...picked, i.id])} />
                {i.name}
              </label>
            ))}
          </div>
        ) : null}
        <p className={NOTE}>Flavor profile: {formatProfile(profile)}</p>
        <Field label="Meal Rating">
          <input className={`${INPUT} xs-mid`} type="number" min={0} value={rating} onChange={(e) => setRating(e.target.value)} />
        </Field>
        <button
          type="button"
          className={`${BTN} self-start`}
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
    </PlaqueBox>
  );
}
