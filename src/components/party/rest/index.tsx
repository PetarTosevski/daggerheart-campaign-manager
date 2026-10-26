"use client";

import { useQuery } from "convex/react";
import dynamic from "next/dynamic";

import { Small } from "@/components/party/sheet-ui";

import { api } from "../../../../convex/_generated/api";
import type { CampaignSlot, CharacterSlot, SlotProps } from "../slots";
import { RestBoundary } from "./boundary";
import { Launcher } from "./launcher";

// D5 party rests (T3, CB 105-106; decision 10). Contract: ../slots.ts.

function RestLoading() {
  return (
    <Small as="p" role="status">
      Loading the rest…
    </Small>
  );
}

// CL8: the picker (and the domain-card list it names swaps from) loads only while a rest is open.
const Picker = dynamic(() => import("./picker").then((m) => m.Picker), { loading: RestLoading });

function OpenRestPicker(props: SlotProps) {
  const state = useQuery(api.rests.current, { campaignId: props.campaignId });
  if (state === undefined) return <RestLoading />;
  return state.open === null ? null : <Picker {...props} />;
}

/** The downtime-move picker on the sheet (page one), shown while a rest is open. */
export const RestPicker: CharacterSlot = (props) => (
  <RestBoundary>
    <OpenRestPicker {...props} />
  </RestBoundary>
);

/** The GM's rest launcher on the dashboard; players see the open rest. */
export const RestLauncher: CampaignSlot = (props) => (
  <RestBoundary>
    <Launcher {...props} />
  </RestBoundary>
);
