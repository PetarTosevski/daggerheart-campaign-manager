import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { errorMessage, setOwnerViewOpen, setReadOnlyBannerMessage } from "../../../../src/lib/convex-errors";
import { api, type Id } from "../convex";
import { colors } from "../theme/colors";
import { radius, space } from "../theme/spacing";
import { Button } from "../ui/button";
import { useCampaignState, type LoadedCampaign } from "./campaign-provider";
import { WritesOffFrame } from "./offline";

/** The website's banner texts (src/components/config/archived-banner.tsx, owner-view-banner.tsx, read-only-banner.tsx). */
export const ARCHIVED_BANNER_TEXT = "This campaign is archived · read-only";
export const OWNER_VIEW_BANNER_TITLE = "Read-only view";
export const OWNER_VIEW_BANNER_TEXT = "You are not in this campaign. Nothing can be changed here.";
export const READ_ONLY_BANNER_TITLE = "Read-only right now.";
export const READ_ONLY_BANNER_DEFAULT = "Everyone can read, but nothing can be changed.";

type AppStatus = FunctionReturnType<typeof api.appStatus.get>;

/**
 * Why the campaign's writes are off, as the server refuses them (convex/lib/functions.ts): the app owner's read-only
 * view (OWNER_VIEW_READ_ONLY), an archived campaign (CAMPAIGN_ARCHIVED, for everyone), and read-only mode
 * (READ_ONLY_MODE, for everyone but the app owner). Null while writes are on.
 */
export function campaignWritesOffReason(
  campaign: Pick<LoadedCampaign, "ownerView" | "archived"> | null,
  appReadOnly: boolean,
): string | null {
  if (campaign?.ownerView) return `${OWNER_VIEW_BANNER_TITLE}: ${OWNER_VIEW_BANNER_TEXT}`;
  if (campaign?.archived) return ARCHIVED_BANNER_TEXT;
  if (appReadOnly) return `${READ_ONLY_BANNER_TITLE} ${READ_ONLY_BANNER_DEFAULT}`;
  return null;
}

/** `appStatus.get` as the frame read it, for the banners (undefined: loading or the read failed). */
const AppStatusContext = createContext<AppStatus | undefined>(undefined);

/**
 * The campaign shell's read-only frame (dcm-gdzi.34): every control that asks `useWritesEnabled` turns off inside it
 * while the campaign is archived, the app owner is only looking (owner view) or the app is in read-only mode (the owner
 * is exempt from that one, as on the server). `CampaignBanners` shows why. Mounted by the campaign layout around every
 * campaign page, inside `LiveOffline`.
 */
export function CampaignReadOnlyFrame({ children }: { children: ReactNode }) {
  const state = useCampaignState();
  const campaign = state.status === "ready" ? state.campaign : null;
  // A failed read (only a suspended account's) fails `campaigns.get` too: the layout's route error boundary shows it.
  const status = useQuery(api.appStatus.get, {});
  // Only asked while read-only mode is on: the app owner may still write then.
  const me = useQuery(api.appAdmin.me, status ? {} : "skip");
  const appReadOnly = status != null && me?.isOwner !== true;
  return (
    <AppStatusContext.Provider value={status}>
      <WritesOffFrame reason={campaignWritesOffReason(campaign, appReadOnly)}>{children}</WritesOffFrame>
    </AppStatusContext.Provider>
  );
}

/**
 * The website's campaign banners, on every campaign page: the app owner's read-only view (with the archived line), else
 * the archived banner (Restore for the creator only, never a co-GM), and read-only mode's banner for everyone.
 */
export function CampaignBanners() {
  const state = useCampaignState();
  const campaign = state.status === "ready" ? state.campaign : null;
  return (
    <View style={styles.stack}>
      {campaign?.ownerView ? (
        <OwnerViewBanner archived={campaign.archived} />
      ) : campaign?.archived ? (
        <ArchivedBanner campaignId={campaign._id} isCreator={campaign.isCreator} />
      ) : null}
      <ReadOnlyBanner />
    </View>
  );
}

function OwnerViewBanner({ archived }: { archived: boolean }) {
  // Syncs an external store (the error text module), not React state; nothing is written to the server.
  useEffect(() => {
    setOwnerViewOpen(true);
    return () => setOwnerViewOpen(false);
  }, []);
  return (
    <View accessibilityRole="summary" style={[styles.banner, styles.owner]} testID="owner-view-banner">
      <Text style={styles.ownerText}>
        <Text style={styles.strong}>{OWNER_VIEW_BANNER_TITLE}</Text> · {OWNER_VIEW_BANNER_TEXT}
      </Text>
      {archived ? <Text style={styles.archivedText}>{ARCHIVED_BANNER_TEXT}</Text> : null}
    </View>
  );
}

function ArchivedBanner({ campaignId, isCreator }: { campaignId: Id<"campaigns">; isCreator: boolean }) {
  const unarchive = useMutation(api.campaignSettings.unarchive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setError(null);
    setBusy(true);
    try {
      await unarchive({ campaignId });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View accessibilityRole="summary" style={[styles.banner, styles.archived]} testID="archived-banner">
      <Text style={styles.archivedText}>{ARCHIVED_BANNER_TEXT}</Text>
      {/* Restore is the one write an archived campaign allows (archived: "allow"), so it ignores the frame. */}
      {isCreator ? (
        <Button disabled={busy} onPress={() => void restore()} variant="outline">
          Restore
        </Button>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function ReadOnlyBanner() {
  const status = useContext(AppStatusContext);
  const message = status?.message ?? null;
  // Syncs an external store (the error text module), so a refused write (READ_ONLY_MODE) says the same thing.
  useEffect(() => {
    setReadOnlyBannerMessage(message);
    return () => setReadOnlyBannerMessage(null);
  }, [message]);
  if (!status) return null;
  return (
    <View accessibilityRole="summary" style={[styles.banner, styles.readOnly]} testID="read-only-banner">
      <Text style={styles.readOnlyText}>
        <Text style={styles.strong}>{READ_ONLY_BANNER_TITLE}</Text> {message ?? READ_ONLY_BANNER_DEFAULT}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    paddingHorizontal: space[4],
  },
  banner: {
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    marginTop: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  owner: {
    backgroundColor: "#0f1c20",
    borderColor: "#3d5a63",
  },
  ownerText: {
    color: "#cfe3ea",
    fontSize: 13,
  },
  archived: {
    alignItems: "flex-start",
    backgroundColor: "#1d1414",
    borderColor: "#4a2a28",
  },
  archivedText: {
    color: "#f3c9bf",
    fontSize: 13,
  },
  readOnly: {
    backgroundColor: "#2d2614",
    borderColor: "#e3b45a",
  },
  readOnlyText: {
    color: "#f3cf86",
    fontSize: 14,
  },
  strong: {
    color: colors.parchment,
    fontWeight: "600",
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
});
