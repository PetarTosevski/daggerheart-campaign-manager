# TASK-107 — D4: Party roster, character creation and the character sheet

- **Status:** Done (2026-10-17)
- **Phase:** D4 of `docs/design-port-roadmap.md`
- **bd:** `dcm-bxp.4`
- **Board:** `Party` (roster, wizard, sheet, beastform, companion), `CampaignHub` party cards
- **Decisions:** `docs/decisions-d3-d11.md` (D4: GM creates and assigns; full sheets visible read-only to all players; all 9 wizard steps as designed)

## Delivered

- **Game data** (`src/lib/srd/*`): 13 classes (4 Hope & Fear), 26 subclasses, 210 domain cards (incl. Dread), 24 ancestries, 15 communities, 6 transformations, weapons and armor (Tier 1 from the board plus the three combat wheelchairs; Tiers 2–4 transcribed from the books in `equipment-tiers.ts`, wired in D5), 24 beastforms, portrait and card art.
- **Rules** (`src/lib/domain/characters/*`): creation pool +2/+1/+1/0/0/−1, starting values, tiers, damage thresholds (armor + level; unarmored = level / 2×level), severity (≥ threshold), HP to mark with an Armor Slot, Stress overflow (one Hit Point total; last Stress → Vulnerable), Hope max = 6 − scars, permanent equipment modifiers to Evasion and Armor Score.
- **Convex** (`convex/characters.ts`): list/get (everyone reads), create (wizard draft validated; Hope & Fear content only when the campaign uses it; the GM may assign the owner), assignOwner (GM), updateSheet (owner/GM; equipment validated server-side: tier, source, class-bound, two-handed vs secondary, magic needs a Spellcast trait; `null` unequips), adjustResource, moveCard (loadout ≤ 5; vault → loadout costs Recall Cost in Stress unless during a rest), setStatus, remove (GM), portrait upload.
- **Extras** (`convex/characterExtras.ts`, `src/components/party/extras/*`): Druid beastforms, Beastbound companion, Motherboard quantum/scrap/relics/Ikonis/18 augments, Beast Feast ingredients and party cookbook, Castle High skyshard.
- **UI:** roster (`/party`), 9-step wizard (`/party/new`, draft kept per device), 3-page sheet (`/party/<id>`: stats/tracks/thresholds/damage calculator/weapons/armor/gold/inventory/features; domain cards loadout and vault; heritage, subclass, story, notes), dashboard party cards with HP/Stress/Hope tiles, kill/revive, scars.

## Notes

- HP and Stress are shown as marked slots out of the maximum everywhere (the board mixed marked and remaining).
- Level, Proficiency and subclass upgrades are read-only until level-up (D5). Death moves, rests, Hope/class feature automation, dice and Wither tokens are D5.

## Reviews

- Security (Opus): pass with fixes, applied — portrait uploads are recorded per character (`portraitUploads`), checked server-side as images ≤ 3 MB, can't be reused by another character, and only a character's own uploads are deleted; upload URLs require edit rights on the character; storage ids are normalised and a bad one can't break the party list; cookbook capped at 100 entries / 500-char descriptions; idempotency keys ≤ 100 characters.
- Architect (Opus): rejected for the same portrait issue, fixed; also fixed — atomic `applyDamage` mutation, one shared resource-rules function (`applyResourceDelta`) for server and optimistic UI, level/Proficiency not editable until level-up, full equipment checks on the starting draft (secondary tier/class/source, barehanded strikes take no secondary, potion is one of the two), card level checked when moving into the loadout, Stress overflow from the dashboard card, deleting a character deletes its extras.
- Deferred to beads: `dcm-bxp.13` (Motherboard Ikonis replaces weapons, Warrior Ikonis Training, augment modifiers), `dcm-bxp.14` (companion Light in the Dark Hope slot), `dcm-bxp.15` (consolidate duplicated display helpers).

## Checks (2026-10-17)

| Command | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | Pass |
| `pnpm test` | 50 files, 411 tests passed |
| `pnpm test:e2e` (includes build) | 39 passed (new: character wizard, character sheet, party roster) |
