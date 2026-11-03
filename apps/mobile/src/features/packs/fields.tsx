import { Text, View } from "react-native";

import type { CombatObjectKind, CombatTerrain, SightMode } from "../../../../../convex/lib/validators/combatMaps";
import type { SpriteCategory, SpriteHeight, SpriteLight } from "../../../../../convex/lib/validators/spritePacks";
import { Button } from "../../ui/button";
import { CLASSIC_LOOKS } from "./labels";
import { styles } from "./styles";

export type FieldValues = {
  category: SpriteCategory;
  w: number;
  h: number;
  sight: SightMode;
  light: SpriteLight;
  height: SpriteHeight;
  classicKind: CombatObjectKind;
  terrain?: CombatTerrain;
};

export type FieldChange =
  | { category: SpriteCategory }
  | { w: number }
  | { h: number }
  | { sight: SightMode }
  | { light: SpriteLight }
  | { height: SpriteHeight }
  | { classicKind: CombatObjectKind }
  | { terrain: CombatTerrain };

const spaceGap = 10;
const SIZES = [1, 2, 3, 4] as const;
const CLASSIC_LABEL: Partial<Record<CombatObjectKind, string>> = { deadtree: "Dead tree", walltorch: "Wall torch" };

function ChipRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map(([v, text]) => (
          <Button key={String(v)} onPress={() => onChange(v)} size="md" variant={v === value ? "solid" : "outline"}>
            {text}
          </Button>
        ))}
      </View>
    </View>
  );
}

/** Label controls for a sprite row or a cut awaiting upload. */
export function SpriteFields({ values, onChange }: { values: FieldValues; onChange: (change: FieldChange) => void }) {
  const sizes = SIZES.map((n) => [n, String(n)] as const);
  const classic = CLASSIC_LOOKS.map((k) => [k, CLASSIC_LABEL[k] ?? k] as const);
  return (
    <View style={{ gap: spaceGap }}>
      <ChipRow
        label="Kind"
        onChange={(category) => onChange({ category })}
        options={[
          ["object", "Object"],
          ["texture", "Terrain texture"],
        ]}
        value={values.category}
      />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <ChipRow label="Width (squares)" onChange={(w) => onChange({ w })} options={sizes} value={values.w} />
        </View>
        <View style={{ flex: 1 }}>
          <ChipRow label="Height (squares)" onChange={(h) => onChange({ h })} options={sizes} value={values.h} />
        </View>
      </View>
      <ChipRow
        label="Sight"
        onChange={(sight) => onChange({ sight })}
        options={[
          ["block", "Blocks sight"],
          ["cover", "Cover"],
          ["none", "None"],
        ]}
        value={values.sight}
      />
      <ChipRow
        label="Gives light"
        onChange={(light) => onChange({ light })}
        options={[
          ["none", "None"],
          ["faintglow", "Faint glow"],
          ["torch", "Torch"],
          ["campfire", "Campfire"],
        ]}
        value={values.light}
      />
      <ChipRow
        label="Shadow"
        onChange={(height) => onChange({ height })}
        options={[
          ["flat", "Flat"],
          ["low", "Low"],
          ["tall", "Tall"],
        ]}
        value={values.height}
      />
      <ChipRow label="Classic look" onChange={(classicKind) => onChange({ classicKind })} options={classic} value={values.classicKind} />
    </View>
  );
}
