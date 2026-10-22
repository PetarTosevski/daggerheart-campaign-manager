# TASK G3: Sheet cards - equal card heights in the fan and vault, grimoire cards list used spells

Plan `.omc/plans/followups-6.yaml`, tracer G3 (no dependencies). Beads: dcm-bxp.132 (every hand card the same
height), dcm-bxp.99.20 (grimoire cards list their used spells). Follows SC1 (`TASK-SC-SC1.md`) and CA7
(`TASK-CA-CA7.md`).

## User answers (binding)

- **dcm-bxp.132** (SC1 question): "if all cards are on the same height I don't care either way". Keep five lines of
  text and the footer, but every card in the hand fan (and the vault row) has the same height whatever its text. The fan
  overlap stays.
- **dcm-bxp.99.20** (CA7 questions): keep the 16° tilt for used cards. A grimoire with one spell used
  (featureUses `card:<id>:<useId>`) stays ready but lists its used spells, e.g. "Used: Slumber - back after a rest". A
  used card moved to the vault keeps its used state until the rest (as built).

## What landed

| File | What |
|------|------|
| `src/components/cards/used-spells.ts` | `usedSpellLines(sheet, cardId)`: one line per used spell, in printed order, `Used: <spell name> - <reset label>` (the label from CA1's `RESET_LABEL`, first letter lowered). It walks the card's effect uses (`cardEffect`), skips `main`, and asks `cardAvailability` with the use id and its limit, so a `times: n` spell is listed only when all n uses are spent. A spell with no limit is listed once any entry for it exists. |
| `src/components/cards/card-dialog.tsx`, `.css` | `CardDialog` and `CardMore` take `spells` and list them under the art (`<ul aria-label="Used spells">`). The dialog is not greyed for them. |
| `sections/domains.tsx` | `CardFace` takes `spells` (grimoire cards only) and lists them under the art. The card keeps its ready name, colour and fan angle. Hand, vault and Domain Deck 'More' pass the same lines. CA7's inline ribbon style moved to `.dk-face-used` in `domains.css`. |
| `sections/domains.css` | One height per group. The hand list stretches its cards (`align-items:stretch`), and each `.dk-hand-card` is a flex column whose face fills it. The vault grid has `grid-auto-rows:1fr`, so every row is as tall as the tallest card. The face's footer stays at the bottom (`margin-top:auto`). On phones the hand list is a one-column grid with equal rows, and faces keep five lines of text (they showed the whole text before), so a long grimoire does not stretch every card. New `.dk-face-spells`. |
| `tests/unit/domains-exhausted.test.tsx` | 4 tests: a grimoire with two used spells stays ready (name, no grey, normal fan angle) and lists both lines in printed order with the right labels. No list when nothing is used or on a non-grimoire. The line goes after a short rest (`expire`). The vault card and its large card show the lines. |
| `tests/unit/card-dialog.test.tsx` | 2 tests: the dialog lists the spells without `data-exhausted`, and shows no list when there are none. |
| `tests/e2e/sheet-cards.spec.ts` | New test at 1440 and 390. A level-4 Bard has Book of Ava, Inspirational Words (long name) and Troublemaker (short text) in hand, and Deft Deceiver (shortest text) and Book of Vagras (longest) in the vault. All hand faces share one layout height, all vault faces share one, and each footer ends at its face's bottom. |

## Notes

- "One height" applies within each group. Hand cards (190 px, 150 px under 1000 px) and vault cards (grid columns of at
  least 170 px) have different widths, and the art keeps its aspect ratio, so the two groups differ.
- The grimoire lines are not checked in e2e. Only a card use on the live map writes a `card:<id>:<useId>` entry, and no
  e2e helper seeds the sheet's `featureUses`. The unit tests render the real section with those entries.

## QUESTIONS

1. Phones now show five lines of text plus 'More' (they showed the whole text before), so all phone cards share one
   height. Keep this, or (b) show the whole text on phones and give up equal height there?
