import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type {
  FearAtStart,
  LorekeeperAsk,
  OutOfRange,
  SessionOpensOn,
} from "../../../../../src/lib/config/campaign-settings";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api, type Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { QueryBoundary } from "../../ui/query-boundary";
import { ChoiceRow, SectionTitle, SwitchRow, controlStyles } from "./controls";
import { PreferenceRows } from "./preferences";

/** One table setting and its new value (rule 12: one field per call). */
export type TableSettingChange = FunctionArgs<typeof api.campaignSettings.set>["change"];

/**
 * The website's text for the Campaign settings rows: `TABLE_TEXT` (sections/table), `LORE_TEXT` (sections/lorekeeper)
 * and `SESSIONS_TEXT` (sections/sessions) in `src/components/config/`.
 */
export const CAMPAIGN_SETTINGS_TEXT = {
  title: "Campaign settings",
  footer: "Changes save as you make them and reach every player at once.",
  table: "At the table",
  fear: { label: "Players see the GM’s Fear", hint: "The Fear banner on the Combat Map." },
  outOfRange: { label: "Out-of-range actions", hint: "When a card or attack targets something beyond its range." },
  spotlight: { label: "Show spotlight balance to players", hint: "The bars in the session recap." },
  lorekeeper: "Lorekeeper",
  web: {
    label: "Search the internet when the books don’t say",
    hint: "Results are marked “From the internet · unofficial”.",
  },
  whoCanAsk: "Who can ask",
  sessions: "Sessions",
  fearAtStart: { label: "GM Fear at the start of a session", hint: "Fear carries over between sessions by default." },
  opensOn: { label: "A new session opens on" },
  sessionLog: {
    label: "Write the session log from the Combat Map",
    hint: "Rolls, hits, Fear spent and defeats, with times.",
  },
} as const;

const OUT_OF_RANGE: readonly { value: OutOfRange; label: string }[] = [
  { value: "ask", label: "Ask me" },
  { value: "refuse", label: "Refuse" },
];
const ASK: readonly { value: LorekeeperAsk; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "gm", label: "GM only" },
];
const FEAR_AT_START: readonly { value: FearAtStart; label: string }[] = [
  { value: "carry", label: "Carry over" },
  { value: "pcs", label: "Reset to number of PCs" },
];
const OPENS_ON: readonly { value: SessionOpensOn; label: string }[] = [
  { value: "journal", label: "Journal" },
  { value: "combatMap", label: "Combat Map" },
];

/**
 * `campaignSettings.set` with an optimistic update on the live `campaigns.get` (rule 12), as the website's sections:
 * the row moves at once and every member sees the change from the same subscription.
 */
function useSetTableSetting(campaignId: Id<"campaigns">) {
  const set = useMutation(api.campaignSettings.set);
  if (!("withOptimisticUpdate" in set)) return set;
  return set.withOptimisticUpdate((store, { change }) => {
    const current = store.getQuery(api.campaigns.get, { campaignId });
    if (current) {
      store.setQuery(api.campaigns.get, { campaignId }, { ...current, settings: { ...current.settings, [change.key]: change.value } });
    }
  });
}

/**
 * `/campaign/<id>/settings`: Campaign settings for the GM and co-GMs (the website's gear: At the table, Lorekeeper and
 * Sessions rows, each saving one field with `campaignSettings.set`), then the account's Preferences for everyone (the
 * website's avatar popover). A player sees only Preferences, as the website gives the panel to GMs only.
 */
export function CampaignSettingsScreen() {
  const campaign = useCampaign();
  const isGm = campaign.role === "gm";
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" style={styles.scroll}>
      <Text accessibilityRole="header" style={styles.title}>
        {isGm ? CAMPAIGN_SETTINGS_TEXT.title : "Settings"}
      </Text>
      {isGm ? <TableSettings campaign={campaign} /> : null}
      <QueryBoundary title="Preferences">
        <PreferenceRows />
      </QueryBoundary>
    </ScrollView>
  );
}

function TableSettings({ campaign }: { campaign: ReturnType<typeof useCampaign> }) {
  const campaignId = campaign._id;
  const set = useSetTableSetting(campaignId);
  const writes = useWritesEnabled() && !campaign.archived && !campaign.ownerView;
  const [error, setError] = useState<string | null>(null);
  const { settings } = campaign;
  const T = CAMPAIGN_SETTINGS_TEXT;

  const change = (next: TableSettingChange) => {
    if (!writes) return;
    setError(null);
    void Promise.resolve()
      .then(() => set({ campaignId, change: next }))
      .catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <View style={styles.sections}>
      <View style={controlStyles.block}>
        <SectionTitle>{T.table}</SectionTitle>
        <SwitchRow
          {...T.fear}
          checked={settings.playersSeeFear}
          disabled={!writes}
          onChange={(value) => change({ key: "playersSeeFear", value })}
        />
        <ChoiceRow
          {...T.outOfRange}
          choices={OUT_OF_RANGE}
          disabled={!writes}
          onChange={(value) => change({ key: "outOfRange", value })}
          value={settings.outOfRange}
        />
        <SwitchRow
          {...T.spotlight}
          checked={settings.spotlightToPlayers}
          disabled={!writes}
          onChange={(value) => change({ key: "spotlightToPlayers", value })}
        />
      </View>
      <View style={controlStyles.block}>
        <SectionTitle>{T.lorekeeper}</SectionTitle>
        <SwitchRow
          {...T.web}
          checked={settings.lorekeeperWeb}
          disabled={!writes}
          onChange={(value) => change({ key: "lorekeeperWeb", value })}
        />
        <ChoiceRow
          choices={ASK}
          disabled={!writes}
          label={T.whoCanAsk}
          onChange={(value) => change({ key: "lorekeeperAsk", value })}
          value={settings.lorekeeperAsk}
        />
      </View>
      <View style={controlStyles.block}>
        <SectionTitle>{T.sessions}</SectionTitle>
        <ChoiceRow
          {...T.fearAtStart}
          choices={FEAR_AT_START}
          disabled={!writes}
          onChange={(value) => change({ key: "fearAtStart", value })}
          value={settings.fearAtStart}
        />
        <ChoiceRow
          {...T.opensOn}
          choices={OPENS_ON}
          disabled={!writes}
          onChange={(value) => change({ key: "sessionOpensOn", value })}
          value={settings.sessionOpensOn}
        />
        <SwitchRow
          {...T.sessionLog}
          checked={settings.autoSessionLog}
          disabled={!writes}
          onChange={(value) => change({ key: "autoSessionLog", value })}
        />
      </View>
      <Text style={controlStyles.hint}>{T.footer}</Text>
      {error ? (
        <Text accessibilityRole="alert" style={controlStyles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    gap: space[6],
    paddingBottom: space[8],
  },
  sections: {
    gap: space[6],
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
});
