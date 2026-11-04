import { describe, expect, it } from "vitest";

import type { AdversaryStep } from "@/lib/domain/adversary-effects/types";
import type { Mod, RollEnd, Step } from "@/lib/domain/card-effects/types";
import type { AdversaryDef } from "@/lib/srd/types";
import { characterSheetSchema, effectSchema, MAX_SHEET_CREATURE_TOKEN_KINDS, sheetCreatureTokensSchema } from "@/lib/validation/characters";

// Plan lanes-2, tracer V4 (docs/tasks/TASK-LN4-V4.md): the vocabulary widened a fourth time, widen only. The fixtures write
// each bead's mechanic with the new pieces (the types are the test: a narrowing breaks the build); the sheet fields parse.

/** dcm-dztv: a standard attack with a damage keyword (Minor Fire Elemental's Elemental Blast, CB p.214). */
const elementalBlast: AdversaryDef["attack"] = { modifier: 3, name: "Elemental Blast", range: "Far", damage: "1d10+4 mag", keyword: "fire" };
/** An attack without one is still valid. */
const claws: AdversaryDef["attack"] = { modifier: 1, name: "Claws", range: "Melee", damage: "1d8+2 phy" };

/** dcm-n7kt: Fire Beam's outright HP (HF p.96), on the card step and on the adversary step. */
const fireBeam: Step = { kind: "markHp", to: "targets", amount: { kind: "fixed", value: 3 }, keyword: "fire" };
const fireBeamAdversary: AdversaryStep = { kind: "markHp", to: "targets", amount: { kind: "fixed", value: 1 }, keyword: "fire" };

/** dcm-hqk1: Reliable Backup (CB p.43): a d20 Hope Die on a Presence Roll in conversation, ended by that roll only. */
const IN_CONVERSATION = "This Presence Roll is made in conversation";
const backupEnd: RollEnd = { roll: "presence", situation: IN_CONVERSATION };
const backupDie: Mod = { kind: "dualityDie", die: "hope", sides: 20, situation: IN_CONVERSATION };
const plainDie: Mod = { kind: "dualityDie", die: "fear", sides: 20 };

describe("the V4 widening (plan lanes-2)", () => {
  it("writes each bead's mechanic with the widened types", () => {
    expect(elementalBlast.keyword).toBe("fire");
    expect(claws.keyword).toBeUndefined();
    expect(fireBeam.kind === "markHp" && fireBeam.keyword).toBe("fire");
    expect(fireBeamAdversary.kind === "markHp" && fireBeamAdversary.keyword).toBe("fire");
    expect(backupEnd.situation).toBe(IN_CONVERSATION);
    expect(backupDie.kind === "dualityDie" && backupDie.situation).toBe(IN_CONVERSATION);
    expect(plainDie.kind === "dualityDie" && plainDie.situation).toBeUndefined();
  });

  it("dcm-lztq + dcm-qxb6: a sheet effect keeps its caster and its target instance; old effects still parse", () => {
    const old = { id: "e1", source: "Eye of the Storm", text: "", until: "manual" };
    expect(effectSchema.safeParse(old).success).toBe(true);
    const marked = effectSchema.parse({ ...old, source: "Marked for Death", casterId: "k17abc", targetInstanceId: "j57xyz" });
    expect(marked).toMatchObject({ casterId: "k17abc", targetInstanceId: "j57xyz" });
    expect(effectSchema.safeParse({ ...old, casterId: "" }).success).toBe(false);
    expect(effectSchema.safeParse({ ...old, targetInstanceId: "x".repeat(41) }).success).toBe(false);
  });

  it("dcm-wiwi: a sheet holds named creature tokens, capped; a sheet without them still parses", () => {
    const field = characterSheetSchema.shape.creatureTokens;
    expect(field.safeParse(undefined).success).toBe(true);
    expect(field.parse([{ name: "leechpole", count: 8 }])).toEqual([{ name: "leechpole", count: 8 }]);
    const many = Array.from({ length: MAX_SHEET_CREATURE_TOKEN_KINDS + 1 }, (_, i) => ({ name: `t${i}`, count: 1 }));
    expect(field.safeParse(many).success).toBe(false);
    expect(sheetCreatureTokensSchema.safeParse({ name: "", count: 1 }).success).toBe(false);
    expect(sheetCreatureTokensSchema.safeParse({ name: "bramble", count: -1 }).success).toBe(false);
    expect(sheetCreatureTokensSchema.safeParse({ name: "bramble", count: 1.5 }).success).toBe(false);
  });
});
