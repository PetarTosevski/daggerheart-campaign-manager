import { useMutation, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { frameName, roman } from "../../../../../src/lib/campaign-display";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import type { CampaignListItem, DeletedCampaign } from "../../../../../convex/campaigns";
import { api, type Id } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Loading } from "../../ui/loading";
import { QueryBoundary } from "../../ui/query-boundary";
import { AccountHeader } from "./chrome";
import { accountStyles } from "./styles";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Chronicle board from `src/app/(gm)/campaigns/chronicle.tsx`. */
export function CampaignListScreen() {
  return (
    <QueryBoundary>
      <CampaignListBody />
    </QueryBoundary>
  );
}

function CampaignListBody() {
  const campaigns = useQuery(api.campaigns.list);
  const restore = useMutation(api.campaigns.restore);
  const router = useRouter();
  const [openId, setOpenId] = useState<Id<"campaigns"> | null | undefined>(undefined);
  const [deleted, setDeleted] = useState<CampaignListItem | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  const ordered = useMemo(
    () => (campaigns === undefined ? undefined : [...campaigns].sort((a, b) => a.createdAt - b.createdAt)),
    [campaigns],
  );
  const expanded = openId === undefined ? campaigns?.[0]?._id : openId;

  if (campaigns === undefined) {
    return (
      <View style={accountStyles.screen}>
        <AccountHeader backHref="/home" backLabel="Back to main menu" title="Load Campaign" />
        <Loading label="Loading campaigns" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={accountStyles.content} style={accountStyles.screen}>
      <AccountHeader backHref="/home" backLabel="Back to main menu" title="Load Campaign" />

      {deleted ? (
        <View accessibilityRole="text" style={styles.undo}>
          <Text style={accountStyles.body}>{undoError ?? `Deleted ${deleted.name}.`}</Text>
          <Button
            onPress={() => {
              setUndoError(null);
              void restore({ campaignId: deleted._id })
                .then(() => {
                  setOpenId(deleted._id);
                  setDeleted(null);
                })
                .catch((e) => setUndoError(errorMessage(e)));
            }}
            size="md"
            variant="outline"
          >
            Undo
          </Button>
        </View>
      ) : null}

      {campaigns.length === 0 ? (
        <View style={styles.empty}>
          <Text style={accountStyles.body}>No saved campaigns.</Text>
          <Button onPress={() => router.push("/new")} size="lg" variant="solid">
            Create a campaign
          </Button>
        </View>
      ) : (
        ordered!.map((campaign, index) => (
          <CampaignBand
            campaign={campaign}
            index={index}
            key={campaign._id}
            onDeleted={(row) => {
              setUndoError(null);
              setDeleted(row);
              setOpenId(null);
            }}
            onToggle={() => setOpenId(campaign._id === expanded ? null : campaign._id)}
            open={campaign._id === expanded}
          />
        ))
      )}

      <DeletedCampaigns
        onPurged={(id) => {
          if (deleted?._id === id) setDeleted(null);
        }}
        onRestored={(id) => {
          setOpenId(id);
          if (deleted?._id === id) setDeleted(null);
        }}
      />
    </ScrollView>
  );
}

function CampaignBand({
  campaign,
  index,
  open,
  onToggle,
  onDeleted,
}: {
  campaign: CampaignListItem;
  index: number;
  open: boolean;
  onToggle: () => void;
  onDeleted: (campaign: CampaignListItem) => void;
}) {
  const router = useRouter();
  const isGm = campaign.role === "gm";
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={[accountStyles.card, open && accountStyles.cardOpen]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setConfirming(false);
          onToggle();
        }}
        style={styles.bandHead}
      >
        <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.numeral, open && styles.numeralOpen]}>
          {roman(index)}
        </Text>
        <View style={styles.bandMain}>
          <Text style={accountStyles.eyebrow}>
            Tier {campaign.tier} · Level {campaign.level} · {frameName(campaign.frameId)} · {isGm ? "Game Master" : "Player"}
          </Text>
          <Text style={styles.name}>{campaign.name}</Text>
          <Text style={accountStyles.label}>
            Started {dateFormat.format(campaign.createdAt)} · Last opened {dateFormat.format(campaign.lastOpenedAt)}
          </Text>
        </View>
        <View style={styles.stats}>
          <Stat label="Players" tone="hope" value={String(campaign.players)} />
          <Stat label="Fear" tone="fear" value={String(campaign.fear)} />
        </View>
      </Pressable>

      {open ? (
        <View style={styles.actions}>
          <Button onPress={() => router.push(`/campaign/${campaign._id}`)} size="lg" variant="solid">
            Resume Campaign
          </Button>
          <Button
            accessibilityLabel={`${isGm ? "Delete" : "Leave"} ${campaign.name}`}
            onPress={() => setConfirming(true)}
            size="lg"
            variant="danger"
          >
            {isGm ? "Delete" : "Leave"}
          </Button>
        </View>
      ) : null}

      {open && confirming ? (
        <ConfirmLeaveOrDelete
          campaign={campaign}
          error={error}
          isGm={isGm}
          onCancel={() => setConfirming(false)}
          onDone={() => (isGm ? onDeleted(campaign) : undefined)}
          onError={setError}
        />
      ) : null}
    </View>
  );
}

function ConfirmLeaveOrDelete({
  campaign,
  isGm,
  onCancel,
  onDone,
  onError,
  error,
}: {
  campaign: CampaignListItem;
  isGm: boolean;
  onCancel: () => void;
  onDone: () => void;
  onError: (message: string | null) => void;
  error: string | null;
}) {
  const remove = useMutation(api.campaigns.remove);
  const leave = useMutation(api.members.leave);

  return (
    <View accessibilityRole="alert" style={styles.confirm}>
      <Text style={styles.confirmText}>
        {isGm ? "Delete" : "Leave"} <Text style={styles.confirmStrong}>{campaign.name}</Text>?{" "}
        {isGm
          ? "It will be removed from your saved campaigns."
          : "You'll need a new invite or join code to come back."}
      </Text>
      <View style={styles.confirmActions}>
        <Button onPress={onCancel} variant="outline">
          Keep it
        </Button>
        <Button
          onPress={() => {
            onError(null);
            void Promise.resolve(isGm ? remove({ campaignId: campaign._id }) : leave({ campaignId: campaign._id }))
              .then(onDone)
              .catch((e) => onError(errorMessage(e)));
          }}
          variant="dangerSolid"
        >
          {isGm ? "Delete" : "Leave"}
        </Button>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={accountStyles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "hope" | "fear" }) {
  return (
    <View style={[styles.stat, tone === "hope" ? styles.statHope : styles.statFear]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function DeletedCampaigns({
  onRestored,
  onPurged,
}: {
  onRestored: (id: Id<"campaigns">) => void;
  onPurged: (id: Id<"campaigns">) => void;
}) {
  const deleted = useQuery(api.campaigns.listDeleted);
  if (!deleted || deleted.length === 0) return null;
  return (
    <View style={styles.deletedSection}>
      <Text accessibilityRole="header" style={accountStyles.eyebrow}>
        Deleted campaigns
      </Text>
      {deleted.map((row) => (
        <DeletedRow campaign={row} key={row._id} onPurged={() => onPurged(row._id)} onRestored={() => onRestored(row._id)} />
      ))}
    </View>
  );
}

function DeletedRow({
  campaign,
  onRestored,
  onPurged,
}: {
  campaign: DeletedCampaign;
  onRestored: () => void;
  onPurged: () => void;
}) {
  const restore = useMutation(api.campaigns.restore);
  const purge = useMutation(api.campaigns.purge);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (action: Promise<null>, done: () => void) => {
    setError(null);
    setBusy(true);
    void Promise.resolve(action).then(
      () => {
        setBusy(false);
        done();
      },
      (e) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };

  return (
    <View style={accountStyles.card}>
      <Text style={styles.name}>{campaign.name}</Text>
      <Text style={accountStyles.label}>
        {frameName(campaign.frameId)} · Deleted {dateFormat.format(campaign.deletedAt)}
      </Text>
      <View style={styles.actions}>
        <Button
          accessibilityLabel={`Restore ${campaign.name}`}
          disabled={busy}
          onPress={() => run(restore({ campaignId: campaign._id }), onRestored)}
          variant="outline"
        >
          Restore
        </Button>
        <Button
          accessibilityLabel={`Delete ${campaign.name} permanently`}
          disabled={busy}
          onPress={() => setConfirming(true)}
          variant="danger"
        >
          Delete permanently
        </Button>
      </View>
      {confirming ? (
        <View accessibilityRole="alert" style={styles.confirm}>
          <Text style={styles.confirmText}>
            Delete <Text style={styles.confirmStrong}>{campaign.name}</Text> permanently? Its characters, sessions, notes and maps
            are erased for good. This can&apos;t be undone.
          </Text>
          <View style={styles.confirmActions}>
            <Button disabled={busy} onPress={() => setConfirming(false)} variant="outline">
              Keep it
            </Button>
            <Button disabled={busy} onPress={() => run(purge({ campaignId: campaign._id }), onPurged)} variant="dangerSolid">
              {`Delete ${campaign.name} forever`}
            </Button>
          </View>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={accountStyles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
    justifyContent: "flex-end",
    paddingHorizontal: space[4],
    paddingBottom: space[4],
  },
  bandHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[4],
    minHeight: hit.minHeight + space[10],
    padding: space[4],
  },
  bandMain: {
    flex: 1,
    gap: space[2],
    minWidth: 200,
  },
  confirm: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerLine,
    borderRadius: 10,
    borderWidth: 1,
    gap: space[3],
    marginHorizontal: space[4],
    marginBottom: space[4],
    padding: space[4],
  },
  confirmActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
  },
  confirmStrong: {
    fontWeight: "700",
  },
  confirmText: {
    ...type.sans,
    color: "#ffd9d6",
    fontSize: 15,
    lineHeight: 22,
  },
  deletedSection: {
    gap: space[3],
    marginTop: space[4],
  },
  empty: {
    alignItems: "center",
    borderColor: colors.line2,
    borderRadius: 16,
    borderStyle: "dashed",
    borderWidth: 2,
    gap: space[4],
    padding: space[8],
  },
  name: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 28,
  },
  numeral: {
    ...type.displayBold,
    color: "#3f3a4e",
    fontSize: 48,
    lineHeight: 48,
    width: 72,
    textAlign: "center",
  },
  numeralOpen: {
    color: colors.brand,
  },
  stat: {
    alignItems: "center",
    borderRadius: 10,
    gap: space[1],
    minWidth: 76,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  statFear: {
    backgroundColor: colors.fearBg,
  },
  statFearLabel: {},
  statHope: {
    backgroundColor: "#16262a",
  },
  statLabel: {
    ...type.sansSemibold,
    color: colors.label,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  statValue: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 24,
  },
  stats: {
    flexDirection: "row",
    gap: space[2],
  },
  undo: {
    alignItems: "center",
    backgroundColor: colors.raised,
    borderColor: colors.line2,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
    justifyContent: "space-between",
    padding: space[4],
  },
});
