"use client";

import { refusalFor } from "@/lib/errors/refusals";
import { cn } from "@/lib/utils";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { hudToasts } from "../blocked";
import { fearShortText } from "../fear/blocked";
import type { PickOutcome, PickPrimary, PickRowInput, PickSessionSpec } from "../pick";
import type { GmActs } from "./acts";
import {
  attackFooter,
  attackLabel,
  attackLine,
  attackReactions,
  attackRuleRange,
  edgeArgs,
  EDGES,
  hasMomentum,
  pickedExperience,
  pickedReactions,
  signed,
  theName,
  type BlockLike,
  type Edge,
} from "./model";

/**
 * The purple picking panel "Acting for the Lieutenant" (plan combat-hud H5.2; GMDesktop 'Adversary acting', CmpPicking;
 * HANDOFF "GM attack picking uses the same pattern in purple"): H3.0's pick session with the adversary's token as the
 * actor, the PCs as rows (`gmAttackRows`: band, in / out of range / can't see), the roll (Normal / Advantage /
 * Disadvantage) as `extra`, each Experience (1 Fear) and each opt-in reaction as options, the footer "Spotlight: 1 Fear ·
 * Momentum on a hit" and one primary "Attack Brannoc". The session id starts with `gm-attack:`; the panel and rings take
 * the GM's purple from it (`.hud-pk-gm`, `.hud-tg-gm`).
 */

export type GmAttackInput = {
  instanceId: string;
  tokenId: Id<"combatTokens">;
  label: string;
  block: BlockLike;
  rows: readonly PickRowInput[];
  /** Map token → character, for the server's `targets` (character ids). */
  characterOf: ReadonlyMap<string, Id<"characters">>;
  /** The Fear this action's own spotlight costs (0 when the adversary already holds it this GM turn). */
  spotlightFear: number;
  /** The GM's Fear when the panel opens (an Experience the GM can't pay opens disabled with the reason); undefined while loading. */
  fear?: number;
  acts: GmActs;
};

/**
 * A refusal at the primary in the refusal table's words (H6.3; CmpBlocked layer 2, "Spotlight the Lieutenant first."):
 * kept under the primary, or (a toast-placed one) sent to the toast host. The session stays open either way.
 */
function refused(error: unknown, adversary: string): PickOutcome {
  const refusal = refusalFor(error, { adversary, viewer: "gm" });
  if (refusal.place === "toast") {
    hudToasts.refusal(refusal);
    return { kind: "stay" };
  }
  return { kind: "stay", message: refusal.text };
}

type Data = { edge: Edge };

function primaryFor(input: GmAttackInput, edge: Edge): PickPrimary {
  const momentum = hasMomentum(input.block);
  return {
    label: (s) => attackLabel(s.targets.map((t) => t.name)),
    pay: (s) => attackFooter({ spotlightFear: input.spotlightFear, experienceFear: pickedExperience(s.options) ? 1 : 0, momentum }),
    blocked: (s) => {
      // Fear is not checked here: the session keeps the numbers it opened with, so the server's answer (FearConfirm,
      // then NOT_ENOUGH_FEAR under the primary, in the table's words) is the live check. Only the Experience options
      // open disabled when the GM's Fear at opening can't pay them.
      return pickedExperience(s.options) === "many" ? "Pick one Experience" : null;
    },
    send: async (s) => {
      const xp = pickedExperience(s.options);
      const experience = xp === "many" ? null : xp;
      const reactions = pickedReactions(s.options);
      const targets = s.targetIds.map((id) => input.characterOf.get(id)).filter((c): c is Id<"characters"> => c !== undefined);
      let done;
      try {
        done = await input.acts.attack(
          { instanceId: input.instanceId, targets, ...edgeArgs(edge), ...(experience ? { experience } : {}), ...(reactions.length ? { reactions } : {}) },
          { label: `${input.label} attacks`, actor: theName(input.label), experience, tokenId: input.tokenId },
        );
      } catch (error) {
        return refused(error, theName(input.label));
      }
      if (done === null) return { kind: "stay", message: "No Fear spent. Nothing was rolled." };
      return { kind: "done" };
    },
  };
}

function EdgeSeg({ value, onPick }: { value: Edge; onPick: (edge: Edge) => void }) {
  return (
    <div className="hsb-seg" role="group" aria-label="Roll">
      {EDGES.map((e) => (
        <button key={e.id} type="button" aria-pressed={value === e.id} className={cn(value === e.id && "on")} onClick={() => onPick(e.id)}>
          {e.label}
        </button>
      ))}
    </div>
  );
}

export function gmAttackSession(input: GmAttackInput): PickSessionSpec<Data> {
  const { block } = input;
  return {
    id: `gm-attack:${input.instanceId}`,
    source: { kind: "adversary", name: `Acting for ${theName(input.label)}` },
    rule: { side: "enemy", max: 1, range: attackRuleRange(block.attack.range), text: attackLine(block) },
    actor: { tokenId: input.tokenId },
    rows: input.rows,
    data: { edge: "none" },
    options: [
      // An Experience costs 1 Fear on top of this action's own spotlight (the server asks for both at once).
      ...block.experiences.map((x) => {
        const short = fearShortText(input.spotlightFear + 1, input.fear);
        return { id: `xp:${x.name}`, label: `Use ${x.name} ${signed(x.value)}`, note: short ?? "Costs 1 Fear", cost: { amount: 1, resource: "fear" as const }, ...(short ? { disabled: true } : {}) };
      }),
      ...attackReactions(block).map((name) => ({ id: `rx:${name}`, label: `Use ${name} on this attack` })),
    ],
    extra: ({ data, update }) => <EdgeSeg value={data.edge} onPick={(edge) => update({ data: { edge }, primary: primaryFor(input, edge) })} />,
    primary: primaryFor(input, "none"),
  };
}

/** A feature that names PC targets (Coup de Grace): the same purple panel, the feature as the source. */
export function gmFeatureSession(input: {
  instanceId: string;
  tokenId: Id<"combatTokens">;
  label: string;
  feature: string;
  max: number | null;
  rows: readonly PickRowInput[];
  characterOf: ReadonlyMap<string, Id<"characters">>;
  useId: string;
  acts: GmActs;
}): PickSessionSpec<null> {
  return {
    id: `gm-attack:${input.instanceId}:${input.feature}`,
    source: { kind: "adversary", name: input.feature },
    rule: { side: "enemy", max: input.max, range: "unlimited", text: `${input.label}: pick ${input.max === 1 ? "1 target" : input.max === null ? "any targets" : `up to ${input.max} targets`}` },
    actor: { tokenId: input.tokenId },
    rows: input.rows,
    data: null,
    primary: {
      label: (s) => (s.targets.length ? `Use on ${s.targets.map((t) => t.name).join(" and ")}` : `Use ${input.feature}`),
      send: async (s) => {
        const targets = s.targetIds.map((id) => input.characterOf.get(id)).filter((c): c is Id<"characters"> => c !== undefined);
        let done;
        try {
          done = await input.acts.feature(
            { instanceId: input.instanceId, feature: input.feature, useId: input.useId, targets },
            { label: `${input.label} uses ${input.feature}`, actor: theName(input.label), feature: input.feature, tokenId: input.tokenId },
          );
        } catch (error) {
          return refused(error, theName(input.label));
        }
        if (done === null) return { kind: "stay", message: "No Fear spent. Nothing happened." };
        return { kind: "done" };
      },
    },
  };
}
