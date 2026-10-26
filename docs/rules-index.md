# Daggerheart Rules Index

## Purpose

This file directs implementation work to the relevant sections of
`reference/daggerheart-srd.pdf`. It is an index, not a copy of the rules.

The SRD PDF identifies itself as System Reference Document 1.0. Confirm the
document version when the local PDF changes.

## How to use this index

Before implementing a rule-dependent feature:

1. Read the indexed SRD section.
2. Check `game-interpretation.md` for explicit house-rule overrides.
3. Record the application interpretation in `game-interpretation.md`.
4. Add acceptance criteria and tests to the relevant task.
5. Do not rely on model memory.

Page references below use the printed SRD page numbers where available. PDF
viewer page numbering may differ because some PDF pages contain two printed
pages.

## Character creation and character state

Reference:

- SRD printed pp. 4–6: character creation
- SRD printed p. 4: level, Evasion, Hit Points, Stress, and Hope
- SRD printed pp. 4–5: starting equipment and Experiences
- SRD printed pp. 7–34: classes, ancestries, and communities
- SRD printed pp. 42–43: leveling and multiclassing

Application areas:

- Character records
- Traits and resources
- Experiences
- Equipment
- Level validation
- Wither-token and scar tracking

## Fear

Reference:

- SRD printed p. 3: Fear generated through Duality Dice
- SRD printed pp. 64 onward: Core GM Mechanics and spending Fear
- SRD printed p. 112: extended downtime Fear
- SRD printed p. 118: Wither-token conversion to Fear at session end

Application areas:

- Current Fear
- Fear-event history
- Extended-downtime preview
- End-of-session Wither-token resolution

Confirmed application decision:

- Campaign Fear is constrained to `0–12` (resolved `OQ-RULE-002`).

Open decisions:

- Whether ordinary week advancement has any Fear effect
- Whether all official Fear spending needs history or only campaign-total
  adjustments

## Countdowns

Reference:

- SRD Core GM Mechanics section: countdown mechanics
- SRD printed p. 112: projects during downtime and Progress Countdowns
- SRD printed p. 112: advancing long-term countdowns during extended downtime
- Adversary and environment entries throughout the SRD provide examples of
  countdown use

Application areas:

- Countdown configuration
- Progress and long-term countdowns
- Value and status history
- Completion consequences

Open decisions:

- Which additional categories may be introduced after Phase 1
- Whether later tasks introduce executable completion effects

Confirmed Phase 1 decisions:

- Categories are `threat`, `project`, `consequence`, and `other`.
- All countdowns count down from a positive initial value to `0`.
- Reversal is allowed up to the initial value.
- Reaching `0` completes automatically; increasing above `0` reopens.
- Consequences remain narrative-only.

## Downtime and campaign time

Reference:

- SRD printed pp. 41–42: downtime
- SRD printed p. 112: projects during downtime
- SRD printed p. 112: extended downtime
- SRD printed pp. 115–116: Witherwild weeks of day and night

Application areas:

- Campaign-week tracker
- Day/night-cycle state
- Long-term countdown advancement
- House-rule additional downtime move

Important distinction:

A campaign week, a rest, a real-world session end, and extended downtime are
separate operations unless the GM explicitly combines them.

## Equipment, inventory, and consumables

Reference:

- SRD printed pp. 44–60: equipment, weapons, armor, loot, and consumables
- SRD printed pp. 4–5: starting equipment

Application areas:

- Character equipment
- Shared inventory
- Consumables
- Inventory transactions

House-rule note:

Weight is ignored and inventory uses slots, but slot limits and item sizing are
not yet defined.

## Food and survival

Reference:

- No generic automatic food-consumption or spoilage system has been confirmed
  from the indexed SRD material.
- The former campaign house rules (food) are historical; see tag `witherwild-final`.

Application areas:

- Food stores
- Weekly consumption
- Spoilage
- Shortage reporting

Confirmed campaign rules:

- One ration per participating character per campaign week
- Fresh food spoils after two campaign weeks
- Preserved food does not spoil through normal weekly spoilage

## Witherwild campaign frame

Reference:

- SRD printed pp. 113–118: The Witherwild Campaign Frame
- SRD printed pp. 115–116: Weeks of Day and Night
- SRD printed p. 118: Corruption from the Witherwild

Application areas:

- Weekly day/night cycle
- Wither tokens by character
- Fear Die check prompt and result recording
- Scars
- End-of-session token clearing and Fear gain
- Withered adversary and environment notes


