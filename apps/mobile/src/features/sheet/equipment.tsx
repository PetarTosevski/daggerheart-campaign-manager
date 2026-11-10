import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useWritesEnabled } from "../../shell/offline";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { armorChoices, armorOf, weaponChoices, weaponDamageLine, weaponOf } from "./catalog";
import { Line, Section } from "./chrome";
import type { SheetData } from "./types";

export function EquipmentSection({
  sheet,
  hopeAndFear,
  canEdit,
  onWeapon,
  onArmor,
}: {
  sheet: SheetData;
  hopeAndFear: boolean;
  canEdit: boolean;
  onWeapon: (slot: "primary" | "secondary", id: string | null) => void;
  onArmor: (id: string | null) => void;
}) {
  const primary = weaponOf(sheet.primaryWeaponId);
  const secondary = weaponOf(sheet.secondaryWeaponId);
  const armor = armorOf(sheet.armorId);
  const writes = useWritesEnabled();
  const [open, setOpen] = useState<"primary" | "secondary" | "armor" | null>(null);
  return (
    <Section title="Equipment">
      <Line
        label="Primary weapon"
        value={
          primary
            ? `${primary.name}, ${primary.trait}, ${primary.range}, ${weaponDamageLine(primary.damage, sheet.proficiency)}`
            : "None"
        }
      />
      <Line
        label="Secondary weapon"
        value={secondary ? `${secondary.name}, ${secondary.trait}, ${secondary.range}, ${secondary.damage}` : "None"}
      />
      <Line
        label="Armor"
        value={armor ? `${armor.name}, score ${armor.score}, ${armor.major}/${armor.severe}` : "Unarmored"}
      />
      <Line label="Proficiency" value={String(sheet.proficiency)} />
      {canEdit ? (
        <View style={styles.row}>
          <Button disabled={!writes} onPress={() => setOpen(open === "primary" ? null : "primary")} variant="outline">
            Change primary weapon
          </Button>
          <Button disabled={!writes} onPress={() => setOpen(open === "secondary" ? null : "secondary")} variant="outline">
            Change secondary weapon
          </Button>
          <Button disabled={!writes} onPress={() => setOpen(open === "armor" ? null : "armor")} variant="outline">
            Change armor
          </Button>
        </View>
      ) : null}
      {open === "primary" || open === "secondary" ? (
        <View style={styles.choices}>
          {open === "secondary" ? (
            <Button disabled={!writes} onPress={() => onWeapon("secondary", null)} variant="outline">
              Unequip secondary weapon
            </Button>
          ) : null}
          {weaponChoices(open, sheet, hopeAndFear).map((weapon) => (
            <Button
              disabled={!writes}
              key={weapon.id}
              onPress={() => {
                onWeapon(open, weapon.id);
                setOpen(null);
              }}
              variant="outline"
            >
              {weapon.name}
            </Button>
          ))}
        </View>
      ) : null}
      {open === "armor" ? (
        <View style={styles.choices}>
          <Button disabled={!writes} onPress={() => onArmor(null)} variant="outline">
            Unequip armor
          </Button>
          {armorChoices(sheet, hopeAndFear).map((item) => (
            <Button
              disabled={!writes}
              key={item.id}
              onPress={() => {
                onArmor(item.id);
                setOpen(null);
              }}
              variant="outline"
            >
              {item.name}
            </Button>
          ))}
        </View>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: space[2],
  },
  choices: {
    gap: space[2],
  },
});
