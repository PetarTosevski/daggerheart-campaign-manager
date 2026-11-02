import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { api } from "../convex";
import { colors } from "../theme/colors";
import { space } from "../theme/spacing";
import { Empty } from "../ui/empty";
import { Loading } from "../ui/loading";

export type LoadedCampaign = NonNullable<FunctionReturnType<typeof api.campaigns.get>>;

type CampaignState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; campaign: LoadedCampaign };

const CampaignContext = createContext<CampaignState | null>(null);

export function firstParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

/**
 * Subscribes to `campaigns.get` once. A null result is "Not found".
 * The role on the result is the campaign role.
 */
export function CampaignProvider({
  campaignId,
  children,
}: {
  campaignId: string;
  children: ReactNode;
}) {
  const campaign = useQuery(api.campaigns.get, campaignId.length > 0 ? { campaignId } : "skip");
  const state: CampaignState =
    campaignId.length === 0 || campaign === null
      ? { status: "missing" }
      : campaign === undefined
        ? { status: "loading" }
        : { status: "ready", campaign };
  return <CampaignContext.Provider value={state}>{children}</CampaignContext.Provider>;
}

export function useCampaignState(): CampaignState {
  const state = useContext(CampaignContext);
  if (!state) throw new Error("useCampaignState must be used inside CampaignProvider");
  return state;
}

/** The loaded campaign. The role is `campaigns.get`'s `role`. */
export function useCampaign(): LoadedCampaign {
  const state = useCampaignState();
  if (state.status !== "ready") throw new Error("useCampaign requires a loaded campaign");
  return state.campaign;
}

/** Loading, Not found, or the screen. Does not subscribe; the provider already did. */
export function CampaignScreen({ children }: { children: ReactNode }) {
  const state = useCampaignState();
  if (state.status === "loading") {
    return (
      <View style={styles.fill}>
        <Loading label="Loading campaign" />
      </View>
    );
  }
  if (state.status === "missing") {
    return (
      <View style={styles.fill}>
        <Empty title="Not found" />
      </View>
    );
  }
  return <View style={styles.fill}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: {
    backgroundColor: colors.ink,
    flex: 1,
    padding: space[4],
  },
});
