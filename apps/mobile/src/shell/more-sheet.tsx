import { ScrollView, StyleSheet } from "react-native";

import { space } from "../theme/spacing";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { moreItems } from "./sections";

export function MoreSheet({
  open,
  onClose,
  isGm,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  isGm: boolean;
  onSelect: (slug: string) => void;
}) {
  return (
    <Sheet onClose={onClose} open={open} title="More">
      <ScrollView contentContainerStyle={styles.list} style={styles.scroll}>
        {moreItems(isGm).map((item) => (
          <Button key={item.slug} onPress={() => onSelect(item.slug)} variant="outline">
            {item.label}
          </Button>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: {
    maxHeight: 480,
  },
  list: {
    gap: space[2],
  },
});
