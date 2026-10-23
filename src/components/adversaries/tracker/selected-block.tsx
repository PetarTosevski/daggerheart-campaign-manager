"use client";

import { useState, type ReactNode } from "react";

import { play3d } from "@/components/party/dice/dice3d";
import { canAnimate3d, useDiceSettings } from "@/components/party/dice/settings";
import { playRollSound } from "@/components/party/dice/sound";

import { StatBlock } from "../catalogue/stat-block";
import type { BlockRules } from "./rules";

/**
 * The selected instance's parchment stat block (A2's StatBlock) with the actions panel (plan combat-actions AA3) above
 * its features (`renderActions`): the targeted Attack and the feature Use buttons, which go through the server. The
 * old untargeted "Roll attack" / "Roll damage" head buttons are gone (AA3b, user answer 2026-10-22: the targeted Attack
 * is the one way to attack). The server's rolls play the 3D dice and the dice sound like the GM roll form (dice
 * settings: 3D off, reduced motion or sound off fall back as there).
 */
export function SelectedBlock({
  rules,
  renderActions,
}: {
  rules: BlockRules;
  /** The adversary actions panel (AA3), given the 3D dice for the server's attack rolls. */
  renderActions: (onDice: (dice: Parameters<typeof play3d>[1]["dice"]) => void) => ReactNode;
}) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [settings] = useDiceSettings();

  async function animate(dice: Parameters<typeof play3d>[1]["dice"]) {
    const shown = canAnimate3d(settings) && stage !== null && (await play3d(stage, { dice, sound: settings.sound }));
    if (!shown && settings.sound) playRollSound();
  }

  const head = <div ref={setStage} className="trk-dice-stage" data-testid="tracker-dice-stage" />;
  return <StatBlock adversary={rules.block} actions={head} tracker={renderActions((dice) => void animate(dice))} />;
}
