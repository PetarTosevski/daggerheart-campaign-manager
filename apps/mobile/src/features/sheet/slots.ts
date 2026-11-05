import { DeathSlot } from "./death";
import { DiceSlot } from "./dice";
import { FeaturesSlot } from "./features";
import { IncomingSlot } from "./incoming";
import { LevelUpSlot } from "./level-up";
import { RestSlot } from "./rest";

/** Every slot the sheet mounts, in contract order. */
export const sheetSlots = [
  { id: "dice", Slot: DiceSlot },
  { id: "level-up", Slot: LevelUpSlot },
  { id: "death", Slot: DeathSlot },
  { id: "incoming", Slot: IncomingSlot },
  { id: "rest", Slot: RestSlot },
  { id: "features", Slot: FeaturesSlot },
] as const;
