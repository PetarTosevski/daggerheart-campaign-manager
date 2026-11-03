import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { styles } from "./styles";

/** Local text while focused; commits trimmed value on blur (website BlurText). */
export function BlurName({
  label,
  value,
  maxLength,
  onCommit,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  maxLength: number;
  onCommit: (name: string) => void;
  accessibilityLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <View style={{ gap: 4, flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        maxLength={maxLength}
        onBlur={() => {
          focused.current = false;
          const trimmed = draft.trim();
          setDraft(trimmed);
          if (trimmed !== value.trim()) onCommit(trimmed);
        }}
        onChangeText={setDraft}
        onFocus={() => {
          focused.current = true;
        }}
        onSubmitEditing={() => {
          const trimmed = draft.trim();
          setDraft(trimmed);
          if (trimmed !== value.trim()) onCommit(trimmed);
        }}
        returnKeyType="done"
        style={styles.input}
        value={draft}
      />
    </View>
  );
}
