import { Text, View } from "react-native";

import { mapLightReach } from "../../../../../../src/lib/domain/combat-map/light";
import { SIGHT_DEFAULTS, SIGHT_LABEL, SIGHT_MODES, sightOf, type SightMode } from "../../../../../../src/lib/domain/combat-map/sight";
import type { ObjectKind } from "../../../../../../src/lib/domain/combat-map/spec";
import {
  OBJECT_R_MAX,
  OBJECT_R_MIN,
  OBJECT_R_STEP,
  OBJECT_ROT_STEP,
  objectLabel,
} from "../../../../../../src/components/combat-map/editor/edit-model";

import { Button } from "../../../ui/button";
import type { CombatMapLayout } from "../contract";
import type { useEditActions } from "./edit-actions";
import { editStyles } from "./styles";
import type { SpriteEditing } from "./use-sprite-editing";

type LayoutObject = CombatMapLayout["objects"][number];

export function CombatObjectPanel({
  object,
  sprites,
  edits,
  onDone,
}: {
  object: LayoutObject;
  sprites: SpriteEditing;
  edits: ReturnType<typeof useEditActions>;
  onDone: () => void;
}) {
  const traits = sprites.traitsOf(object);
  const label = sprites.nameOf(object) ?? objectLabel(object.kind);
  const effective = sightOf({ kind: object.kind, sight: object.sight ?? null, traits, open: object.open ?? null });
  const fallback: SightMode = traits?.sight ?? (SIGHT_DEFAULTS as Readonly<Record<string, SightMode>>)[object.kind as ObjectKind] ?? "none";
  const reach = mapLightReach({ kind: object.kind, traits });
  const lit = object.lit !== false;

  return (
    <View accessibilityRole="summary" style={editStyles.panel} testID="combat-object-panel">
      <Text style={editStyles.title}>{label}</Text>
      <Text style={editStyles.label}>Sight</Text>
      <View style={editStyles.row}>
        {SIGHT_MODES.map((mode) => (
          <Button key={mode} onPress={() => edits.setSight(object._id, mode)} variant={effective === mode ? "solid" : "outline"}>
            {SIGHT_LABEL[mode]}
          </Button>
        ))}
      </View>
      <Text style={editStyles.hint}>
        {object.sight === undefined
          ? `Default for a ${label.toLowerCase()}: ${SIGHT_LABEL[fallback].toLowerCase()}.`
          : `Set by hand (default: ${SIGHT_LABEL[fallback].toLowerCase()}).`}
      </Text>
      {object.sight !== undefined ? (
        <Button onPress={() => edits.setSight(object._id, "default")} variant="outline">
          Use the default
        </Button>
      ) : null}
      {reach ? (
        <>
          <Button onPress={() => edits.update(object._id, { lit: !lit })} variant="outline">
            {lit ? "Lit · tap to put out" : "Unlit · tap to light"}
          </Button>
          <Text style={editStyles.hint}>
            At night: clear to {reach[0]} squares, dim to {reach[1]}.
          </Text>
        </>
      ) : null}
      <View style={editStyles.row}>
        <Button disabled={object.r <= OBJECT_R_MIN} onPress={() => edits.update(object._id, { r: object.r - OBJECT_R_STEP })} variant="outline">
          Smaller
        </Button>
        <Button disabled={object.r >= OBJECT_R_MAX} onPress={() => edits.update(object._id, { r: object.r + OBJECT_R_STEP })} variant="outline">
          Bigger
        </Button>
        <Button accessibilityLabel="Rotate left" onPress={() => edits.update(object._id, { rot: object.rot - OBJECT_ROT_STEP })} variant="outline">
          ⟲
        </Button>
        <Button accessibilityLabel="Rotate right" onPress={() => edits.update(object._id, { rot: object.rot + OBJECT_ROT_STEP })} variant="outline">
          ⟳
        </Button>
      </View>
      <View style={editStyles.row}>
        <Button onPress={onDone} variant="outline">
          Done
        </Button>
        <Button
          onPress={() => {
            edits.remove(object._id);
            onDone();
          }}
          variant="outline"
        >
          Delete
        </Button>
      </View>
    </View>
  );
}
