import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  FLAVOR_DIE,
  FLAVOR_LABEL,
  FLAVORS,
  harvestCount,
  type Flavor,
} from "../../../../../../../../src/lib/domain/frames/beast-feast";
import {
  formatProfile,
  MAX_STRENGTH,
  profileOf,
  type BeastFeastState,
  type CookbookEntry,
  type FlavorProfile,
} from "../../../../../../../../src/lib/frames/extras/beast-feast";
import { api } from "../../../../../convex";
import type { Id } from "../../../../../convex";
import { colors } from "../../../../../theme/colors";
import { type } from "../../../../../theme/fonts";
import { radius, space } from "../../../../../theme/spacing";
import { Button } from "../../../../../ui/button";
import { useIntent } from "../../intent";
import {
  CheckOption,
  FeatureError,
  FeatureField,
  FeatureLabel,
  FeatureNote,
  FeatureSection,
} from "../../ui";

type Recipe = CookbookEntry & { canRemove: boolean };
type FlavorRow = { flavor: Flavor; strength: number };

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
    <FeatureSection
      accessibilityLabel="Beast Feast Ingredients and Cookbook"
      testID="beast-feast"
      title="Ingredients & Cookbook"
    >
      <FeatureNote>What you carry from the hunt, and the dishes the party has cooked.</FeatureNote>
      <IngredientsCard
        characterId={characterId}
        state={state}
        capacity={capacity}
        canEdit={canEdit}
      />
      <CookbookCard
        campaignId={campaignId}
        cookbook={cookbook}
        ingredients={state.ingredients}
        canEdit={canEdit}
      />
    </FeatureSection>
  );
}

function IngredientsCard({
  characterId,
  state,
  capacity,
  canEdit,
}: {
  characterId: Id<"characters">;
  state: BeastFeastState;
  capacity: number;
  canEdit: boolean;
}) {
  const add = useIntent(api.characterExtras.addIngredient);
  const remove = useIntent(api.characterExtras.removeIngredient);
  const [name, setName] = useState("");
  const [flavors, setFlavors] = useState<FlavorRow[]>([{ flavor: "sweet", strength: 1 }]);
  const [feature, setFeature] = useState("");
  const [beastHp, setBeastHp] = useState("");
  const full = state.ingredients.length >= capacity;
  const hp = Number(beastHp);

  return (
    <View style={styles.block}>
      <FeatureLabel>{`Carrying ${state.ingredients.length} / ${capacity}`}</FeatureLabel>
      <FeatureNote>You can carry as many ingredients as your highest trait.</FeatureNote>
      {state.ingredients.length === 0 ? <FeatureNote>No ingredients.</FeatureNote> : null}
      {state.ingredients.map((i) => (
        <View key={i.id} style={styles.item}>
          <Text style={styles.itemName}>{i.name}</Text>
          <Text style={styles.itemMeta}>
            {i.flavors.map((f) => `${FLAVOR_LABEL[f.flavor]} (${f.strength})`).join(", ")}
          </Text>
          {i.feature ? <Text style={styles.itemFeature}>{i.feature}</Text> : null}
          {canEdit ? (
            <Button
              accessibilityLabel={`Remove ${i.name}`}
              disabled={remove.pending}
              onPress={() => void remove.fire({ characterId, ingredientId: i.id })}
              variant="outline"
            >
              Remove
            </Button>
          ) : null}
        </View>
      ))}

      {canEdit ? (
        <View style={styles.block}>
          <FeatureLabel>Add an ingredient</FeatureLabel>
          <FeatureField
            label="Ingredient name"
            value={name}
            onChangeText={setName}
            maxLength={80}
          />
          {flavors.map((row, k) => (
            <View key={k} style={styles.block}>
              <FeatureLabel>{`Flavor ${k + 1}`}</FeatureLabel>
              {FLAVORS.map((f) => (
                <CheckOption
                  key={f}
                  label={`${FLAVOR_LABEL[f]} (d${FLAVOR_DIE[f]})`}
                  checked={row.flavor === f}
                  onPress={() =>
                    setFlavors(flavors.map((r, j) => (j === k ? { ...r, flavor: f } : r)))
                  }
                />
              ))}
              <FeatureLabel>Strength</FeatureLabel>
              {Array.from({ length: MAX_STRENGTH }, (_, s) => (
                <CheckOption
                  key={s}
                  label={String(s + 1)}
                  checked={row.strength === s + 1}
                  onPress={() =>
                    setFlavors(
                      flavors.map((r, j) => (j === k ? { ...r, strength: s + 1 } : r)),
                    )
                  }
                />
              ))}
              {flavors.length > 1 ? (
                <Button
                  accessibilityLabel={`Remove flavor ${k + 1}`}
                  onPress={() => setFlavors(flavors.filter((_, j) => j !== k))}
                  variant="outline"
                >
                  Remove flavor
                </Button>
              ) : null}
            </View>
          ))}
          {flavors.length < 3 ? (
            <Button
              accessibilityLabel="Add flavor"
              onPress={() =>
                setFlavors([
                  ...flavors,
                  {
                    flavor: FLAVORS.find((f) => !flavors.some((r) => r.flavor === f)) ?? "weird",
                    strength: 1,
                  },
                ])
              }
              variant="outline"
            >
              Add flavor
            </Button>
          ) : null}
          <FeatureField
            label="Feature (rare ingredients only)"
            value={feature}
            onChangeText={setFeature}
            maxLength={300}
          />
          <Button
            accessibilityLabel={full ? "Hands full" : "Add ingredient"}
            disabled={!name.trim() || full || add.pending}
            onPress={async () => {
              const ok = await add.fire({
                characterId,
                ingredient: { name, flavors, ...(feature.trim() ? { feature } : {}) },
              });
              if (ok !== undefined) {
                setName("");
                setFeature("");
                setFlavors([{ flavor: "sweet", strength: 1 }]);
              }
            }}
            variant="solid"
          >
            {full ? "Hands full" : "Add ingredient"}
          </Button>
        </View>
      ) : null}

      <FeatureLabel>Harvest: beast&apos;s maximum HP</FeatureLabel>
      <FeatureField
        label="Beast HP"
        value={beastHp}
        onChangeText={(v) => setBeastHp(v.replace(/[^0-9]/g, "").slice(0, 4))}
        keyboardType="number-pad"
      />
      {beastHp && hp > 0 ? (
        <FeatureNote>{`Yields ${harvestCount(hp)} ingredient(s); the GM sets their flavors.`}</FeatureNote>
      ) : null}
      <FeatureError error={add.error ?? remove.error} />
    </View>
  );
}

function CookbookCard({
  campaignId,
  cookbook,
  ingredients,
  canEdit,
}: {
  campaignId: Id<"campaigns">;
  cookbook: Recipe[];
  ingredients: BeastFeastState["ingredients"];
  canEdit: boolean;
}) {
  const add = useIntent(api.characterExtras.addCookbookEntry);
  const remove = useIntent(api.characterExtras.removeCookbookEntry);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [rating, setRating] = useState("");
  const chosen = ingredients.filter((i) => picked.includes(i.id));
  const profile: FlavorProfile = profileOf(chosen);

  return (
    <View style={styles.block}>
      <FeatureLabel>Party Cookbook</FeatureLabel>
      <FeatureNote>
        Cooking a recorded flavor profile again adds tokens equal to the party’s tier.
      </FeatureNote>
      {cookbook.length === 0 ? <FeatureNote>No recipes yet.</FeatureNote> : null}
      {cookbook.map((e) => (
        <View key={e.id} style={styles.item}>
          <Text style={styles.itemName}>{e.name}</Text>
          <Text style={styles.itemMeta}>{formatProfile(e.profile)}</Text>
          {e.mealRating !== null ? (
            <Text style={styles.itemMeta}>{`Meal Rating ${e.mealRating}`}</Text>
          ) : null}
          {e.ingredients.length ? (
            <Text style={styles.itemMeta}>{e.ingredients.join(", ")}</Text>
          ) : null}
          {e.description ? <Text style={styles.itemFeature}>{e.description}</Text> : null}
          {e.canRemove ? (
            <Button
              accessibilityLabel={`Remove ${e.name}`}
              disabled={remove.pending}
              onPress={() => void remove.fire({ campaignId, entryId: e.id })}
              variant="outline"
            >
              Remove
            </Button>
          ) : null}
        </View>
      ))}

      {canEdit ? (
        <View style={styles.block}>
          <FeatureLabel>Record a recipe</FeatureLabel>
          <FeatureField label="Dish name" value={name} onChangeText={setName} maxLength={80} />
          <FeatureField
            label="Dish description"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={2000}
          />
          {ingredients.length ? (
            <>
              <FeatureLabel>Ingredients</FeatureLabel>
              {ingredients.map((i) => (
                <CheckOption
                  key={i.id}
                  label={i.name}
                  checked={picked.includes(i.id)}
                  onPress={() =>
                    setPicked(
                      picked.includes(i.id)
                        ? picked.filter((x) => x !== i.id)
                        : [...picked, i.id],
                    )
                  }
                />
              ))}
            </>
          ) : null}
          <FeatureNote>{`Flavor profile: ${formatProfile(profile)}`}</FeatureNote>
          <FeatureField
            label="Meal Rating"
            value={rating}
            onChangeText={(v) => setRating(v.replace(/[^0-9]/g, "").slice(0, 3))}
            keyboardType="number-pad"
          />
          <Button
            accessibilityLabel="Add to cookbook"
            disabled={!name.trim() || add.pending}
            onPress={async () => {
              const ok = await add.fire({
                campaignId,
                entry: {
                  name,
                  description,
                  ingredients: chosen.map((i) => i.name),
                  profile,
                  mealRating: rating === "" ? null : Number(rating),
                },
              });
              if (ok !== undefined) {
                setName("");
                setDescription("");
                setPicked([]);
                setRating("");
              }
            }}
            variant="solid"
          >
            Add to cookbook
          </Button>
          <FeatureNote>Spend the cooked ingredients from your list after recording the dish.</FeatureNote>
        </View>
      ) : null}
      <FeatureError error={add.error ?? remove.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[2] },
  item: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[1],
    padding: space[3],
  },
  itemName: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 15,
    fontWeight: type.sansSemibold.fontWeight,
  },
  itemMeta: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  itemFeature: {
    color: colors.body,
    fontFamily: type.serifItalic.fontFamily,
    fontSize: 14,
    fontStyle: "italic",
  },
});
