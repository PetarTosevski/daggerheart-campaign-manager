# TASK-CA-CA2: Adversary resistance table from stat-block text

Plan `.omc/plans/combat-actions.yaml`, tracer CA2, user answer Q8 (default a): always-on resistances and immunities of the
SRD adversaries apply automatically; conditional ones become a GM toggle on the encounter instance; odd texts stay manual.

## Rule (CB p.99, "Resistance and Immunity")

> If the text doesn't specify whether resistance or immunity applies to physical or magic damage, the effect applies to both.
> When a creature has resistance to a damage type, they halve damage of that type before comparing it to their damage
> thresholds. ... When a creature has immunity to a damage type, they do not take any damage from an attack that deals
> damage of that type. ... If an attack deals both physical and magic damage, you can only benefit from resistance or
> immunity if you are resistant or immune to both damage types.

Applying it (halve and round down, immunity first, both types needed for mixed damage) is CA1's `applyDamageTo`. This
tracer only supplies the data.

## Module

`src/lib/srd/adversary-resistance.ts` (framework-free):

- `ADVERSARY_RESISTANCE`: adversary id → `{physical, magic: none|resistant|immune, conditional?, manual?, feature}`.
  `conditional` holds the condition text; the levels are the resistance while it holds. `manual` holds damage text on the same
  feature that the GM handles by hand.
- `RESISTANCE_EXCLUSIONS`: features that mention resistance or immunity but grant none against damage to the adversary itself.
- `alwaysOnResistance(id)`: the levels to apply automatically (none for conditional, excluded and unknown ids).
- `conditionalResistance(id)`: the entry when it is conditional, for the GM toggle.
- `mentionsResistance(text)`: the `/resistan|immun/i` scan.

`tests/unit/adversary-resistance.test.ts` scans every feature of all 267 SRD adversaries (core, Hope & Fear and the three
Reign of the Weredragon blocks); it fails if a matching feature has neither a table entry nor an exclusion, or if an entry is
stale or contradicts its text.

## Classification (34 features)

Always on (24): physical resistance: Skeleton Warrior, Phantom, Poltergeist, Banshee, Dullahan, Entombed Empress, Failed
Experiment, Guahalan Spirit Beast, Spectral Archer, Spectral Captain, Spectral Guardian, Whisper Wraith, Volcanic Dragon:
Obsidian Predator, Zombie Legion, Scarecrow. Physical immunity: Ghastly Legion. Magic resistance: Minor Chaos Elemental,
Chaos Skull, Gargoyle, Roc, Shapeshifting Fiend, Shapeshifting Fiend (revealed), Owl Witch. Physical immunity plus magic
resistance: Cephilith Titan.

Conditional, GM toggle (7):

| Adversary | Levels while it holds | Condition |
| --- | --- | --- |
| Landshark | resistant to both | while underground (can't attack) |
| Landshark Behemoth | immune to both | while underground (can't attack) |
| Stonewraith | immune to both | while within stone or earth |
| Oak Treant | physical resistant | while Rooted |
| Hydra | magic immune | while Dazed (after magic damage, until the next roll with Fear) |
| Cloud Titan | physical immune | in misty cloud form; also takes double magic damage (manual) |
| Phoenix | immune to both | as the Smoldering Egg after defeat |

Manual notes on entries (stay with the GM): Scarecrow "takes double damage from fire"; Ghastly Legion "takes double magic
damage"; Cloud Titan double magic damage in cloud form.

Excluded (3):

- Yufo, Psychic Strongbox: immune to abilities and features that affect its thoughts or emotions, not to damage.
- Vault Guardian Gaoler, Blocking Shield: "Creatures trapped inside the Gaoler are immune to this feature".
- Cult Adept, Shroud of the Fallen: gives an ally Protection (resistance to all damage); the GM toggles a conditional
  resistance on the protected ally, not on the Adept.

Not in scope (no "resistance" or "immune" in the text, left manual): damage-halving reactions (Vampire Mistform, Adult
Flickerfly Uncanny Reflexes, Crimson Lepus Evasive) and features that make the adversary deal double damage.
