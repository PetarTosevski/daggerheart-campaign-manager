/**
 * Plan lanes-2, wave 10, tracer E8.4 (dcm-txlu): the level-up asks for a gained card's "when you choose this card" picks.
 * Vitality (CB p.330): "When you choose this card, permanently gain two of the following benefits: • One Stress slot • One
 * Hit Point slot • +2 bonus to your damage thresholds". blade.ts Vitality is not data yet (S1.4), so a fixture stands in.
 */
import { describe, expect, it } from "vitest";

import type { CardEffect } from "@/lib/domain/card-effects/types";
import { cardChoiceAsks, cardChoiceProblems, cardChoicesFor } from "@/lib/domain/level-up/card-choices";

const vitality = {
  cardId: "vitality",
  uses: [
    {
      id: "main",
      name: "Vitality",
      activation: { kind: "auto", trigger: { kind: "whenYouChooseThisCard" } },
      steps: [
        {
          kind: "choose",
          id: "benefits",
          label: "Two benefits",
          count: { kind: "fixed", value: 2 },
          distinct: true,
          options: [
            { id: "stress", label: "One Stress slot", steps: [] },
            { id: "hp", label: "One Hit Point slot", steps: [] },
            { id: "thresholds", label: "+2 to your damage thresholds", steps: [] },
          ],
        },
        { kind: "toVault", permanent: true },
      ],
    },
  ],
} as unknown as CardEffect;

const lookup = (id: string) => (id === "vitality" ? vitality : undefined);

describe("cardChoiceAsks", () => {
  it("lists the choose steps of a gained card's choosing use, once per card", () => {
    const asks = cardChoiceAsks(["other", "vitality", "vitality", ""], lookup);
    expect(asks).toEqual([
      {
        cardId: "vitality",
        name: "Vitality",
        stepId: "benefits",
        label: "Two benefits",
        count: 2,
        distinct: true,
        options: [
          { id: "stress", label: "One Stress slot" },
          { id: "hp", label: "One Hit Point slot" },
          { id: "thresholds", label: "+2 to your damage thresholds" },
        ],
      },
    ]);
  });

  it("a card without such a use asks nothing (the real SRD lookup too)", () => {
    expect(cardChoiceAsks(["other"], lookup)).toEqual([]);
    expect(cardChoiceAsks(["not-a-card"])).toEqual([]);
  });
});

describe("cardChoiceProblems / cardChoicesFor", () => {
  const asks = cardChoiceAsks(["vitality"], lookup);

  it("needs exactly the count, distinct, of known options", () => {
    expect(cardChoiceProblems(asks, {})).toEqual(["Vitality: choose 2 (Two benefits)."]);
    expect(cardChoiceProblems(asks, { vitality: { benefits: ["hp"] } })).toHaveLength(1);
    expect(cardChoiceProblems(asks, { vitality: { benefits: ["hp", "hp"] } })).toHaveLength(1);
    expect(cardChoiceProblems(asks, { vitality: { benefits: ["hp", "nope"] } })).toHaveLength(1);
    expect(cardChoiceProblems(asks, { vitality: { benefits: ["hp", "thresholds"] } })).toEqual([]);
  });

  it("keeps only the picks that belong to the asks, at most the count", () => {
    expect(cardChoicesFor(asks, { vitality: { benefits: ["hp", "nope", "stress", "thresholds"], other: ["x"] }, gone: { a: ["b"] } })).toEqual({ vitality: { benefits: ["hp", "stress"] } });
    expect(cardChoicesFor(asks, {})).toEqual({});
  });
});
