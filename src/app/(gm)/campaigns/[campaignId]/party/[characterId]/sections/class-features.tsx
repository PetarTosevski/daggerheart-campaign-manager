"use client";

import "./class-features.css";

import { ClassExtras } from "@/components/party/extras/character-extras";
import { FeaturesPanel } from "@/components/party/features";
import { SheetBox } from "@/components/party/sheet-ui";
import type { ClassDef } from "@/lib/srd";

import { FeatureText } from "../fields";
import { useSheet } from "../sheet-context";

// Class Features box of page 1 (board: Party.dc.html lines 905-919): Beastform / Companion launchers
// (ClassExtras, S7), the cf rows (FeaturesPanel, S6), then the class feature text in a "Full feature text" disclosure.

export function ClassFeaturesBox({ cls }: { cls: ClassDef | undefined }) {
  const { slot } = useSheet();
  return (
    <SheetBox title="Class Features">
      <ClassExtras {...slot} />
      <FeaturesPanel {...slot} />
      {cls && cls.classFeatures.length > 0 ? (
        <details className="cf-full">
          <summary className="sh-lbl">Full feature text</summary>
          <div className="cf-full-body">
            {cls.classFeatures.map((f) => (
              <FeatureText key={f.name} name={f.name} text={f.text} />
            ))}
          </div>
        </details>
      ) : null}
    </SheetBox>
  );
}
