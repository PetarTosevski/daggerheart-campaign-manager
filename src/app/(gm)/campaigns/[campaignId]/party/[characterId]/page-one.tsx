"use client";

import { SheetDiceBox } from "@/components/party/dice";
import { LunarPhasesSlot } from "@/components/party/lunar";
import type { ClassDef } from "@/lib/srd";

import { ClassFeaturesBox } from "./sections/class-features";
import { DefenceBox, HopeBox } from "./sections/defence-hope";
import { DowntimeBox } from "./sections/downtime";
import { ActiveArmorBox, ActiveWeaponsBox } from "./sections/equipment";
import { FrameExtrasRegion } from "./sections/frame-extras";
import { HitPointsStressBox } from "./sections/hp-stress";
import { IdentitySection } from "./sections/identity";
import { useSheet } from "./sheet-context";

/** Character Sheet page in the board's order. Composition only: each box lives in sections/. Status controls sit under the footer (sheet.tsx). */
export function PageOne({ cls }: { cls: ClassDef | undefined }) {
  const { slot } = useSheet();
  return (
    <div className="cs-page">
      <IdentitySection cls={cls} />
      <div className="cs-grid">
        <DefenceBox />
        <HopeBox cls={cls} />
      </div>
      <SheetDiceBox {...slot} />
      <div className="cs-grid">
        <HitPointsStressBox />
        <ActiveWeaponsBox />
      </div>
      <div className="cs-grid">
        <div className="cs-col">
          <ActiveArmorBox />
          <ClassFeaturesBox cls={cls} />
          <LunarPhasesSlot {...slot} />
        </div>
        <DowntimeBox />
      </div>
      <FrameExtrasRegion />
    </div>
  );
}
