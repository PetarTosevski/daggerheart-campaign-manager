"use client";

import "./class-features.css";

import { ClassExtras } from "@/components/party/extras/character-extras";
import { FeaturesPanel } from "@/components/party/features";
import { SheetBox } from "@/components/party/sheet-ui";
import type { ClassDef } from "@/lib/srd";

import { FeatureText } from "../fields";
import { useSheet } from "../sheet-context";

// Class Features box of page 1: Beastform / Companion (ClassExtras, S7), class actions, held dice and effects
// (FeaturesPanel, S6), then the class feature text. Restyled by S6.

export function ClassFeaturesBox({ cls }: { cls: ClassDef | undefined }) {
  const { slot } = useSheet();
  return (
    <SheetBox title="Class Features">
      <ClassExtras {...slot} />
      <FeaturesPanel {...slot} />
      {cls?.classFeatures.map((f) => <FeatureText key={f.name} name={f.name} text={f.text} />)}
    </SheetBox>
  );
}
