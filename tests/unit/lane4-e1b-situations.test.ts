/**
 * Plan lanes-2 wave 10, E1.4b (dcm-hqk1): the dice box's "In conversation" check box (Reliable Backup, CB p.43: "When you
 * make a Presence Roll in conversation, they back you up. You can roll a d20 as your Hope Die").
 */
import { describe, expect, it } from "vitest";

import { situationalDice } from "@/components/party/dice/situations";
import type { Mod } from "@/lib/domain/card-effects/types";

const conversation = "This Presence Roll is made in conversation";
const lookup = (label: string): Mod[] => (label === "Contacts Everywhere: d20 Hope Die in conversation" ? [{ kind: "dualityDie", die: "hope", sides: 20, situation: conversation }] : []);

describe("situationalDice", () => {
  it("offers the effect's situational Hope Die, once per situation", () => {
    const effects = [
      { id: "feat:abc:1", text: "Contacts Everywhere: d20 Hope Die in conversation; option: backup" },
      { id: "feat:abc:2", text: "Contacts Everywhere: d20 Hope Die in conversation" },
      { id: "card:x:1", text: "Something else" },
    ];
    expect(situationalDice(effects, lookup)).toEqual([{ situation: conversation, label: "Contacts Everywhere: d20 Hope Die in conversation", sides: 20 }]);
  });

  it("nothing without such an effect; the SRD tables are read by default", () => {
    expect(situationalDice([], lookup)).toEqual([]);
    expect(situationalDice(undefined, lookup)).toEqual([]);
    expect(situationalDice([{ id: "x", text: "Not a backup" }])).toEqual([]);
  });
});
