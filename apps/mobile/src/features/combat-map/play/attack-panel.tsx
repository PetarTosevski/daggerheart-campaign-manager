import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { sightRule } from "../../../../../../src/lib/domain/combat-actions/sight";
import { RANGE_BANDS } from "../../../../../../src/lib/domain/combat-map/ranges";
import { TRAIT_LABEL } from "../../../../../../src/lib/frames/extras/common";
import { TRAIT_IDS, type TraitId } from "../../../../../../src/lib/srd/types";

import { api, type Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { Button } from "../../../ui/button";
import { useIntent } from "../../sheet/dice/intent";

import { Chip, ChipRow, dockText } from "../chip";
import type { CombatSlotProps } from "../contract";
import { AfterRollOffer, MinionPicker, ResultCard } from "./result-card";
import { attackResultView, type AttackResult, type ResolvedAttack } from "./results";
import { attackWeapons, damageLabel, type WeaponSlot } from "./weapons";

type OkView = Extract<CombatSlotProps["view"], { state: "ok" }>;
type TargetHint = FunctionReturnType<typeof api.combatActionsReads.targets>[number];

const BAND: Record<string, string> = Object.fromEntries([...RANGE_BANDS.map((b) => [b.key, b.label]), ["veryFar", "Very Far"]]);

/**
 * The target chip's quiet line: band, out of range (the GM approves first, Q1), line of sight and cover as the M1 rule
 * switch has them (CB p.104; Book refuses no line of sight and gives cover's disadvantage, Manual only tells).
 */
function hintLine(hint: TargetHint, mode: "book" | "manual"): string {
  const parts = [BAND[hint.band] ?? hint.band];
  if (!hint.inRange) parts.push("out of range");
  if (!hint.lineOfSight) parts.push(mode === "manual" ? "no line of sight (GM rules)" : "no line of sight");
  else if (hint.cover) parts.push(mode === "manual" ? "cover (GM rules)" : "cover: disadvantage");
  return parts.join(" · ");
}

type Shown = { result: AttackResult; weaponName: string };

/**
 * A weapon attack from the phone (dcm-gdzi.16): any equipped weapon (primary or secondary), the targets the server
 * says the character sees (`combatActionsReads.targets`, with band, range, line of sight and cover), the trait for a
 * "choice" weapon, and the result: Hit / Miss, damage, waiting for the GM, the after-roll offer and the Minion pick.
 */
export function AttackPanel({ campaignId, layout, view }: { campaignId: Id<"campaigns">; layout: CombatSlotProps["layout"]; view: OkView }) {
  const character = useQuery(api.charactersReads.get, { characterId: view.characterId });
  const sightMode = useQuery(api.ruleSettings.get, { campaignId })?.modes.lineOfSight ?? "book";
  const attack = useIntent(api.combatActions.attack);
  const writes = useWritesEnabled();
  const [slot, setSlot] = useState<WeaponSlot>("primary");
  const [trait, setTrait] = useState<TraitId | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  const weapons = character ? attackWeapons(character.sheet) : [];
  const active = weapons.find((w) => w.slot === slot) ?? weapons[0] ?? null;
  const hints = useQuery(
    api.combatActionsReads.targets,
    active ? { campaignId, characterId: view.characterId, mapId: layout._id, slot: active.slot } : "skip",
  );

  if (character === undefined) {
    return (
      <Text accessibilityRole="status" style={dockText.hint}>
        Loading your weapons…
      </Text>
    );
  }
  if (character === null) return null;

  const names = new Map<string, string>(view.others.map((t) => [t._id, t.name]));
  const usable = (hints ?? []).filter((h) => names.has(h.tokenId));
  const target = usable.find((h) => h.tokenId === targetId) ?? null;
  const refused = (h: TargetHint) => sightRule(names.get(h.tokenId) ?? "", h, sightMode).refused;
  const needsTrait = active?.weapon.trait === "choice";
  const blocked = !active ? "Equip a weapon on your sheet to attack." : !target ? "Pick an enemy target." : refused(target) ? "No line of sight to that target." : needsTrait && trait === null ? "Pick the trait to attack with." : null;

  async function fire() {
    if (!writes || !active || !target || blocked !== null) return;
    const out = await attack.fire({
      campaignId,
      characterId: view.characterId,
      mapId: layout._id,
      targetTokenIds: [target.tokenId],
      slot: active.slot,
      ...(needsTrait && trait !== null ? { trait } : {}),
      modifier: 0,
      experienceIds: [],
      advantage: 0,
      disadvantage: 0,
      help: 0,
      options: [],
    });
    if (out !== undefined) setShown({ result: out, weaponName: active.weapon.name });
  }

  const resolved: ResolvedAttack | null = shown?.result.status === "resolved" ? shown.result : null;

  return (
    <View accessibilityLabel="Weapon attack" style={styles.wrap} testID="combat-play-attack">
      {weapons.length > 1 ? (
        <ChipRow label="Weapons">
          {weapons.map((w) => (
            <Chip key={w.slot} label={w.weapon.name} onPress={() => setSlot(w.slot)} selected={active?.slot === w.slot} testID={`combat-weapon-${w.slot}`} />
          ))}
        </ChipRow>
      ) : null}
      {active ? (
        <Text style={dockText.title}>
          {active.weapon.name} · {damageLabel(active.weapon, character.sheet.proficiency)}
        </Text>
      ) : null}
      {needsTrait ? (
        <ChipRow label="Trait">
          {TRAIT_IDS.map((t) => (
            <Chip key={t} label={TRAIT_LABEL[t]} onPress={() => setTrait(t)} selected={trait === t} />
          ))}
        </ChipRow>
      ) : null}
      {active && hints === undefined ? <Text style={dockText.hint}>Finding targets…</Text> : null}
      {active && hints !== undefined && usable.length === 0 ? (
        <Text style={dockText.hint} testID="combat-play-no-targets">
          No enemies in sight to target.
        </Text>
      ) : null}
      {usable.length > 0 ? (
        <ChipRow label="Attack targets" testID="combat-play-targets">
          {usable.map((h) => (
            <Chip
              accessibilityLabel={`Target ${names.get(h.tokenId)}`}
              disabled={refused(h)}
              hint={hintLine(h, sightMode)}
              key={h.tokenId}
              label={names.get(h.tokenId) ?? "Enemy"}
              onPress={() => setTargetId(targetId === h.tokenId ? null : h.tokenId)}
              selected={target?.tokenId === h.tokenId}
              testID={`combat-target-${h.tokenId}`}
            />
          ))}
        </ChipRow>
      ) : null}
      {blocked && active ? <Text style={dockText.hint}>{blocked}</Text> : null}
      <Button accessibilityLabel="Attack selected target" disabled={!writes || attack.pending || blocked !== null} onPress={() => void fire()} variant="solid">
        {attack.pending ? "Rolling…" : target ? `Attack ${names.get(target.tokenId)}` : "Attack"}
      </Button>
      {attack.error ? (
        <Text accessibilityRole="alert" style={dockText.error}>
          {attack.error}
        </Text>
      ) : null}
      {shown ? <ResultCard onDismiss={() => setShown(null)} testID="combat-attack-result" view={attackResultView(shown.weaponName, shown.result, names)} /> : null}
      {shown?.result.status === "awaiting" ? (
        <AfterRollOffer
          campaignId={campaignId}
          onDone={(out) => setShown(out.status === "resolved" ? { result: out, weaponName: shown.weaponName } : null)}
          options={shown.result.options}
          requestId={shown.result.requestId}
        />
      ) : null}
      {resolved?.minionOffer ? (
        <MinionPicker
          campaignId={campaignId}
          entryId={resolved.entryId}
          offer={resolved.minionOffer}
          onDone={() => setShown({ result: { ...resolved, minionOffer: null }, weaponName: shown!.weaponName })}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: 10 } });
