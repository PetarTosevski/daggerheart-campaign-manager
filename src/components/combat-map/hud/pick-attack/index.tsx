"use client";

import "./attack.css";

/**
 * The weapon attack picker (plan combat-hud H3.2). The entry point for H3.4's action ring is `useAttackPicker(state)`
 * (use-attack.tsx): `{ ready, reason, open(options?), isOpen, forced }`; `open()` from a click handler opens the
 * picking panel with weapon tiles, roll chips, Lead by Example and riders, `open({ forcedRequestId })` a forced attack.
 * `HudAttack` (mounted in the shell's pop region) shows the Forced attack and Minion prompt cards, the last result line
 * and the interim "Weapon attack" button. See docs/tasks/TASK-HUD-H3.2.md.
 */

export { HudAttack } from "./prompts";
export { useAttackPicker, type AttackPicker, type AttackPickerOptions } from "./use-attack";
export { attackReports, useAttackReport } from "./report";
export {
  attackArgs,
  attackBlocked,
  attackLabel,
  attackPatch,
  attackRule,
  attackSession,
  attackSessionId,
  benefitOptions,
  costOf,
  forcedRows,
  initialData,
  minionPicks,
  minionSession,
  minionTitle,
  mostTargets,
  payLine,
  reportOf,
  switchWeapon,
  targetPhrase,
  type AttackData,
  type AttackInput,
  type AttackReport,
  type ForcedAttack,
  type MinionData,
  type MinionOffer,
} from "./model";
