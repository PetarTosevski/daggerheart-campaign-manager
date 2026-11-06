import { useMutation, useQuery } from "convex/react";
import { Component, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { errorMessage, setOwnerViewOpen, setReadOnlyBannerMessage } from "../../../../../src/lib/convex-errors";
import { api, type Id } from "../../../src/convex";
import { DashboardScreen } from "../../../src/features/dashboard";
import { CampaignScreen, useCampaign } from "../../../src/shell/campaign-provider";
import { colors } from "../../../src/theme/colors";
import { radius, space } from "../../../src/theme/spacing";
import { Button } from "../../../src/ui/button";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

/** The website's banner texts (src/components/config/archived-banner.tsx, owner-view-banner.tsx, read-only-banner.tsx). */
export const ARCHIVED_BANNER_TEXT = "This campaign is archived · read-only";
export const OWNER_VIEW_BANNER_TITLE = "Read-only view";
export const OWNER_VIEW_BANNER_TEXT = "You are not in this campaign. Nothing can be changed here.";
export const READ_ONLY_BANNER_TITLE = "Read-only right now.";
export const READ_ONLY_BANNER_DEFAULT = "Everyone can read, but nothing can be changed.";

export default function DashboardRoute() {
  return (
    <CampaignScreen>
      <CampaignBanners />
      <DashboardScreen />
    </CampaignScreen>
  );
}

/**
 * The website's campaign banners, as the web shell mounts them: the app owner's read-only view (with the archived line),
 * else the archived banner (Restore for the creator only, never a co-GM), and read-only mode's banner for everyone.
 */
function CampaignBanners() {
  const campaign = useCampaign();
  return (
    <>
      {campaign.ownerView ? (
        <OwnerViewBanner archived={campaign.archived} />
      ) : campaign.archived ? (
        <ArchivedBanner campaignId={campaign._id} isCreator={campaign.isCreator} />
      ) : null}
      <QuietBoundary>
        <ReadOnlyBanner />
      </QuietBoundary>
    </>
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
  const status = useQuery(api.appStatus.get, {});
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

/** A banner never takes the page down (rule 11): a failed read renders nothing. */
class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    marginBottom: space[3],
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
