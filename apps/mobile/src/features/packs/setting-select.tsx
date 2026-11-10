import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { SETTINGS } from "../../../../../src/lib/sprite-packs/settings";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";
import { styles } from "./styles";

export function SettingSelect({
  value,
  onChange,
  accessibilityLabel,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  accessibilityLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const label =
    value === null ? "New setting" : (SETTINGS.find((s) => s.id === value)?.label ?? `Add to ${value}`);

  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel ?? "Pack setting"}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.input}
      >
        <Text style={{ ...type.sans, color: colors.parchment }}>{label}</Text>
      </Pressable>
      <Modal animationType="slide" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <Pressable accessibilityLabel="Close setting picker" onPress={() => setOpen(false)} style={modal.backdrop}>
          <View style={modal.sheet}>
            <Text accessibilityRole="header" style={modal.title}>
              Setting
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Option
                label="New setting"
                onPick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                selected={value === null}
              />
              {SETTINGS.map((s) => (
                <Option
                  key={s.id}
                  label={`Add to ${s.label}`}
                  onPick={() => {
                    onChange(s.id);
                    setOpen(false);
                  }}
                  selected={value === s.id}
                />
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function Option({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPick}
      style={[modal.option, selected ? modal.optionOn : null]}
    >
      <Text style={modal.optionText}>{label}</Text>
    </Pressable>
  );
}

const modal = {
  backdrop: {
    flex: 1,
    justifyContent: "flex-end" as const,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    maxHeight: "70%" as const,
    backgroundColor: colors.panel,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space[4],
    gap: space[3],
  },
  title: { ...type.sansSemibold, color: colors.parchment, fontSize: 18 },
  option: {
    minHeight: hit.minHeight,
    justifyContent: "center" as const,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  optionOn: { backgroundColor: colors.line },
  optionText: { ...type.sans, color: colors.parchment },
};
