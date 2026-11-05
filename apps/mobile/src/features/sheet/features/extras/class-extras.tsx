import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import type { Id } from "../../../../convex";
import { space } from "../../../../theme/spacing";
import { Sheet } from "../../../../ui/sheet";
import { LauncherRow } from "../ui";
import { BeastformPanel } from "./panels/beastform";
import { CompanionPanel } from "./panels/companion";
import type { ExtrasView } from "./use-extras-view";

type Open = "beastform" | "companion" | null;

/**
 * Class extras inside the Class Features section: launcher rows for Druid
 * Beastform and the Beastbound Companion. Each row opens a bottom Sheet
 * holding its full panel.
 */
export function ClassExtras({
  characterId,
  view,
}: {
  characterId: Id<"characters">;
  view: ExtrasView;
}) {
  const [open, setOpen] = useState<Open>(null);
  if (!view.beastform && !view.companion) return null;
  const close = () => setOpen(null);
  const { canEdit } = view;

  return (
    <View style={styles.stack}>
      {view.beastform ? (
        <>
          <LauncherRow action="Beastform" onPress={() => setOpen("beastform")}>
            Beastform: mark a Stress to transform into a creature of your tier or lower.
          </LauncherRow>
          <Sheet open={open === "beastform"} onClose={close} title="Druid Beastform">
            <ScrollView contentContainerStyle={styles.scroll}>
              <BeastformPanel
                characterId={characterId}
                state={view.beastform}
                tier={view.tier}
                canEdit={canEdit}
              />
            </ScrollView>
          </Sheet>
        </>
      ) : null}
      {view.companion ? (
        <>
          <LauncherRow action="Companion" onPress={() => setOpen("companion")}>
            Companion: your Beastbound animal companion and their training.
          </LauncherRow>
          <Sheet open={open === "companion"} onClose={close} title="Ranger Companion">
            <ScrollView contentContainerStyle={styles.scroll}>
              <CompanionPanel
                characterId={characterId}
                state={view.companion}
                level={view.level}
                canEdit={canEdit}
              />
            </ScrollView>
          </Sheet>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[2] },
  scroll: { gap: space[3], paddingBottom: space[8] },
});
