"use client";

import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { api } from "../../../../../../convex/_generated/api";
import { useCampaign } from "../campaign-shell";
import { MapCalendar } from "./map-calendar";
import { WorldBoard } from "./world-board";
import "./world.css";

function World() {
  const campaign = useCampaign();
  const data = useQuery(api.maps.get, { campaignId: campaign._id });
  // `?focus=` from the dashboard's Locations panel, `?token=` from the Codex's "Show on map" (dcm-bxp.16).
  const params = useSearchParams();
  const focus = Number(params.get("focus") ?? params.get("token"));
  if (data === undefined) return <main className="px-4 py-12 text-[16px] text-[#9fb2b6] sm:px-12">Unrolling the map…</main>;
  return (
    <>
      {/* The campaign calendar above the map (plan world-journey MC1): the Witherwild arc or the day card. */}
      <MapCalendar campaign={campaign} />
      <WorldBoard key={campaign._id} campaignId={campaign._id} campaignName={campaign.name} data={data} focusId={Number.isInteger(focus) && focus > 0 ? focus : null} />
    </>
  );
}

/** World board: the campaign's map with tokens, the party, terrain and routes (D6). */
export default function WorldPage() {
  return (
    <Suspense fallback={null}>
      <World />
    </Suspense>
  );
}
