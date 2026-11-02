import { armorOf, defenseOf, hopeMax, scarsMax, thresholdsOf } from "./catalog";
import { Line, Section, Stepper } from "./chrome";
import type { Resource, SheetData } from "./types";

export function ResourcesSection({
  sheet,
  augments,
  readOnly,
  shown,
  onStep,
}: {
  sheet: SheetData;
  augments: readonly string[];
  readOnly: boolean;
  shown: (resource: Resource) => number;
  onStep: (resource: Resource, delta: number) => void;
}) {
  const defense = defenseOf(sheet, augments);
  const thresholds = thresholdsOf(sheet);
  const armor = armorOf(sheet.armorId);
  const hopeCap = hopeMax(shown("scars"), sheet.hopeSlotBonus);
  const scarCap = scarsMax(sheet.hopeSlotBonus);
  return (
    <Section title="Resources">
      <Stepper
        detail={`Hope ${shown("hope")} of ${hopeCap}`}
        label="Hope"
        max={hopeCap}
        min={0}
        onStep={(delta) => onStep("hope", delta)}
        readOnly={readOnly}
        value={shown("hope")}
      />
      <Stepper
        detail={`Hit Points ${shown("hp")} of ${sheet.hpMax}`}
        label="Hit Points"
        max={sheet.hpMax}
        min={0}
        onStep={(delta) => onStep("hp", delta)}
        readOnly={readOnly}
        value={shown("hp")}
      />
      <Stepper
        detail={`Stress ${shown("stress")} of ${sheet.stressMax}`}
        label="Stress"
        max={sheet.stressMax}
        min={0}
        onStep={(delta) => onStep("stress", delta)}
        readOnly={readOnly}
        value={shown("stress")}
      />
      <Stepper
        detail={`Armor ${shown("armor")} of ${defense.armorScore}`}
        label="Armor"
        max={defense.armorScore}
        min={0}
        onStep={(delta) => onStep("armor", delta)}
        readOnly={readOnly}
        value={shown("armor")}
      />
      <Stepper
        detail={`Scars ${shown("scars")} of ${scarCap}`}
        label="Scars"
        max={scarCap}
        min={0}
        onStep={(delta) => onStep("scars", delta)}
        readOnly={readOnly}
        value={shown("scars")}
      />
      <Line label="Evasion" value={String(defense.evasion)} />
      <Line
        label="Thresholds"
        value={`${armor ? armor.name : "Unarmored"} · Major ${thresholds.major} · Severe ${thresholds.severe}`}
      />
    </Section>
  );
}
