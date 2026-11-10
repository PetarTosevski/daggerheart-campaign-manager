import { Image } from "expo-image";
import { Pressable, StyleSheet, Text } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";

import { codexStyles } from "./styles";

export function Cover({
  url,
  name,
  gm,
  onOpen,
}: {
  url: string | null;
  name: string;
  gm: boolean;
  onOpen: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={url ? `Open picture of ${name || "this entry"}` : gm ? "No picture yet" : "No picture"}
      accessibilityRole="button"
      disabled={!url}
      onPress={onOpen}
      style={codexStyles.cover}
    >
      {url ? (
        <Image accessibilityIgnoresInvertColors source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : gm ? (
        <Text style={styles.placeholder}>No picture yet</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    padding: 16,
  },
});
