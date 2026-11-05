import { StyleSheet, View } from "react-native";

import type { SheetSlotProps } from "../contract";
import { space } from "../../../theme/spacing";

import { LevelUpDraftProvider } from "./draft";
import { LevelUpControls } from "./controls";
import { AdvancementHistory, CorrectLevel } from "./history";
import { LevelUpRibbon } from "./ribbon";
import { fullSheet } from "./shared";

export function LevelUpSlot(props: SheetSlotProps) {
  const sheet = fullSheet(props.character);
  return (
    <LevelUpDraftProvider slot={props}>
      <View accessibilityLabel={`Level-up slot for ${props.character.sheet.name}`} style={styles.stack}>
        <LevelUpControls slot={props} />
        <LevelUpRibbon />
        {sheet ? (
          <>
            <AdvancementHistory hopeAndFear={props.hopeAndFear} sheet={sheet} />
            <CorrectLevel characterId={props.character._id} isGm={props.isGm} level={sheet.level} />
          </>
        ) : null}
      </View>
    </LevelUpDraftProvider>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[4], marginBottom: space[4] },
});
