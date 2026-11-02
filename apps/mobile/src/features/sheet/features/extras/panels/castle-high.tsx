import { useState } from "react";
import { View, StyleSheet } from "react-native";

import type { CastleHighState } from "../../../../../../../../src/lib/frames/extras/castle-high";
import { api } from "../../../../../convex";
import type { Id } from "../../../../../convex";
import { space } from "../../../../../theme/spacing";
import { Button } from "../../../../../ui/button";
import { useIntent } from "../../intent";
import {
  FeatureError,
  FeatureField,
  FeatureNote,
  FeatureSection,
} from "../../ui";

/** Castle High student's skyshard artifact (Hope & Fear p.125). */
export function CastleHighPanel({
  characterId,
  state,
  canEdit,
}: {
  characterId: Id<"characters">;
  state: CastleHighState;
  canEdit: boolean;
}) {
  const save = useIntent(api.characterExtras.saveSkyshard);
  const [name, setName] = useState(state.skyshard.name);
  const [description, setDescription] = useState(state.skyshard.description);
  const dirty = name !== state.skyshard.name || description !== state.skyshard.description;

  return (
    <FeatureSection
      accessibilityLabel="Skyshard Artifact"
      testID="castle-high"
      title="Skyshard Artifact"
    >
      <FeatureNote>
        An object holding a skyshard, attuned to grant its bearer controllable flight.
      </FeatureNote>
      <FeatureField label="Artifact" value={name} onChangeText={setName} maxLength={80} />
      <FeatureField
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
      />
      {canEdit ? (
        <View style={styles.row}>
          <Button
            accessibilityLabel="Save skyshard"
            disabled={!dirty || save.pending}
            onPress={() => void save.fire({ characterId, skyshard: { name, description } })}
            variant="solid"
          >
            Save skyshard
          </Button>
        </View>
      ) : !name && !description ? (
        <FeatureNote>No skyshard recorded yet.</FeatureNote>
      ) : null}
      <FeatureError error={save.error} />
    </FeatureSection>
  );
}

const styles = StyleSheet.create({
  row: { gap: space[2] },
});
