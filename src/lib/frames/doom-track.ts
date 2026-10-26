// Journey to Horizon's Doom Track, transcribed from the Hope & Fear appendix
// sheet ("Journey to Horizon · Doom Track"). At the end of each session the GM
// marks a box in the party's tier or below; a nested box can be marked only
// after the box it is nested under. Pure data: bundled into Convex.

export type DoomBox = { id: string; text: string; children?: DoomBox[] };

export type DoomTier = {
  tier: 1 | 2 | 3 | 4;
  title: string;
  /** The tier's rule, as printed. */
  rule: string;
  boxes: DoomBox[];
};

const box = (id: string, text: string, children?: DoomBox[]): DoomBox => (children ? { id, text, children } : { id, text });

export const DOOM_TRACK: DoomTier[] = [
  {
    tier: 1,
    title: "Dark Harbingers",
    rule: "After you mark 5 boxes in this tier, when you gain Fear at the end of a long rest, you roll twice and take the higher result.",
    boxes: [
      box("1a", "Bandits and marauders harry travelers.", [
        box("1a1", "Tensions rise over contested resources."),
        box("1a2", "A mysteriously empty sanctuary is discovered."),
        box("1a3", "A sanctuary seals itself off once again."),
      ]),
      box("1b", "A new settlement is overtaken by surging wilderness.", [
        box("1b1", "Chimeric dire beasts reveal their presence."),
        box("1b2", "Swarms of overgrown insects darken the sky."),
        box("1b3", "Wild magic shatters magic and crumbles stone."),
        box("1b4", "Terrana supercharges magic dangerously and unpredictably."),
      ]),
      box("1c", "A shadowblighted orchard turns to ash overnight.", [
        box("1c1", "Desiccated and blackened birds fall dead from the sky."),
        box("1c2", "Shadowblighted echoes of lost loved ones appear."),
      ]),
      box("1d", "Travelers trade stories of Seeker sightings.", [
        box("1d1", "The party suffers visions of the Lovers’ re-emergence."),
        box("1d2", "An Aurelian shrine lies broken and desecrated."),
        box("1d3", "The party finds signs of a Seeker."),
        box("1d4", "The party finds remnants of a cult ritual."),
        box("1d5", "A cultist spy tracks the party."),
        box("1d6", "The Vessel attracts attention—and suspicion."),
      ]),
    ],
  },
  {
    tier: 2,
    title: "Rising Threats",
    rule: "After you mark 5 boxes in this tier, when you generate a region and the result on the d20 is a 1, treat it as if you’d rolled 1 twice in a row.",
    boxes: [
      box("2a", "Roving bands of professional soldiers demand tribute at swordpoint.", [
        box("2a1", "A demagogue rises to power with promises of prosperity."),
        box("2a2", "A noble demands fealty from their neighbors."),
        box("2a3", "A prominent figure in the Aurelian Order persecutes the unfaithful."),
        box("2a4", "Civilians are drafted in preparation for war."),
      ]),
      box("2b", "Chaotic weather kills the harvest.", [
        box("2b1", "Tidal waves and tornadoes batter Valloren."),
        box("2b2", "Dire beasts and walking carnivorous plants attack."),
        box("2b3", "A fungal plague spreads through the land."),
        box("2b4", "Food stores are spoiled by pestilence."),
        box("2b5", "The ground cracks open, releasing a toxic miasma."),
      ]),
      box("2c", "Shadowblight swamps a sanctuary, trapping its inhabitants.", [
        box("2c1", "A reservoir’s water turns into tar."),
        box("2c2", "Sorrowblighted humanoids emerge from hidden settlements."),
      ]),
      box("2d", "A Seeker crosses the party’s path.", [
        box("2d1", "An irreplaceable repository of Old Valloren knowledge is destroyed."),
        box("2d2", "Numerous Aurelian priests are slain in a coordinated attack."),
        box("2d3", "A Seeker chases the party, forcing them to flee."),
        box("2d4", "An enemy discovers the Vessel’s true nature."),
      ]),
    ],
  },
  {
    tier: 3,
    title: "Imminent Destruction",
    rule: "After you mark 5 boxes in this tier, adversaries gain the following feature: Dark-Hearted - Passive: Spend a Fear to give the adversary advantage on its next roll.",
    boxes: [
      box("3a", "War is declared, and each sanctuary is called to claim a side.", [
        box("3a1", "A sanctuary falls to internal strife."),
        box("3a2", "A vast military force sweeps through the continent."),
        box("3a3", "A sanctuary is besieged, then falls to military force."),
      ]),
      box("3b", "An explosion of verdant abundance renders regions impassable.", [
        box("3b1", "An ancient creature awakens from millennia of dreamless slumber."),
        box("3b2", "Unleashed terrana drives people into animalistic fury."),
        box("3b3", "Spellcasting triggers magical exhaustion."),
        box("3b4", "Beasts of legend leave their lairs to terrorize the population."),
      ]),
      box("3c", "Color drains from the world.", [
        box("3c1", "Victims of the Long Sorrow crawl from their graves."),
        box("3c2", "Entire fields, forests, jungles, and wetlands fall to rot."),
        box("3c3", "Unrestrained shadowblight triggers inescapable despair."),
      ]),
      box("3d", "A Seeker corners the party, forcing them to fight.", [
        box("3d1", "A powerful personage reveals their Cult allegiance."),
        box("3d2", "A defeated Seeker reappears with newfound abilities or allies."),
        box("3d3", "An army of cultists sweeps across Valloren culling sanctuaries."),
      ]),
      box("3e", "The Vessel is lost or stolen."),
    ],
  },
  {
    tier: 4,
    title: "Final Cataclysm",
    rule: "Each time you mark a box from this tier, you gain a number of Fear equal to the number of marked boxes in this tier.",
    boxes: [
      box("4a", "A group of Seekers ambushes the party."),
      box("4b", "Valloren is riven by an impassable mire of shadowblight."),
      box("4c", "A tyrant claims the crown of Valloren."),
      box("4d", "An assassin mortally wounds a party member."),
      box("4e", "In pockets of reality, time warps and bends in on itself."),
      box("4f", "A wave of wild magic sweeps across the continent, transforming everything it touches into overgrown, uncanny forms."),
      box("4g", "Whole sanctuaries are terrorized by colossal agents of the earth, raging at its exploitation."),
      box("4h", "The sky turns black forever, plunging Valloren into endless midnight."),
      box("4i", "One by one, sanctuaries slip under the surface of an infinite sea of shadowblight."),
      box("4j", "The veil of death is torn asunder, spewing shambling corpses and unclean spirits into the mortal realm.", [
        box("4j1", "The Lovers awaken and begin weaving the Second Sorrow.", [box("4j1a", "The Vessel is destroyed.")]),
      ]),
    ],
  },
];

/** Every box id with its parent id (null for top-level) and tier. */
export const DOOM_BOXES: { id: string; parent: string | null; tier: 1 | 2 | 3 | 4; text: string }[] = DOOM_TRACK.flatMap((t) => {
  const out: { id: string; parent: string | null; tier: 1 | 2 | 3 | 4; text: string }[] = [];
  const walk = (b: DoomBox, parent: string | null) => {
    out.push({ id: b.id, parent, tier: t.tier, text: b.text });
    b.children?.forEach((c) => walk(c, b.id));
  };
  t.boxes.forEach((b) => walk(b, null));
  return out;
});
