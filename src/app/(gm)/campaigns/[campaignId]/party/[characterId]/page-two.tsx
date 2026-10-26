"use client";

import { AdvancementTiers } from "@/components/party/level-up";
import type { ClassDef } from "@/lib/srd";

import { BackgroundBox, ConnectionsBox, DescriptionBox, InventoryBox, NotesBox, WealthBox } from "./sections/story";
import { useSheet } from "./sheet-context";

/** Story & Advancement page in the board's order. Composition only: each box lives in sections/. */
export function PageTwo({ cls }: { cls: ClassDef | undefined }) {
  const { slot } = useSheet();
  return (
    <div className="cs-page">
      <div className="cs-grid-story">
        <WealthBox />
        <InventoryBox className="cs-span-2" />
      </div>
      <div className="cs-grid-text">
        <DescriptionBox cls={cls} />
        <BackgroundBox cls={cls} />
        <ConnectionsBox cls={cls} />
      </div>
      <AdvancementTiers {...slot} />
      <NotesBox />
    </div>
  );
}
