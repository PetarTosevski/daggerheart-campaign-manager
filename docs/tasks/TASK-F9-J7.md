# TASK-F9-J7: Notes with many characters, the preload spec after PF9, the Lorekeeper drawer reopen race (dcm-bxp.141)

Plan: `.omc/plans/followups-9.yaml`, tracer J7. The full e2e run on `rebuild` had 14 failures from three causes.

## Notes journals lose their character (11 Notes failures)

`liveCharacters` (`convex/lib/notes.ts`) read the caller's first 200 characters across every campaign (`by_owner`,
`take(200)`) and only then kept this campaign's. The shared e2e player account owns hundreds of characters on the
persistent e2e backend (517 at the failing run), so its newest characters fell outside the read. The journal was created
without `characterId`, and every label fell back to the account name ("e2e-player" instead of "Liriel" / "Ash"). A real
long-time player would hit the same.

Fix: the index `characters.by_owner_campaign` [`ownerId`, `campaignId`] replaces `by_owner` (schema-guard forbids an
index that is a field-prefix of another); `liveCharacters` reads `eq(owner).eq(campaign)` with a bounded `take`, and
`convex/cleanup.ts` (does the user still own anything) reads it as a prefix query on `ownerId`. Test: `tests/convex/notes-many-characters.test.ts` (a player with 210
older characters in another campaign gets their character on the journal, by name and `characterId`, and on the GM's
'Shared by players' rows). It fails on the old query.

## campaign-preload spec after PF9

PF9 (`939e12b`) moved the dashboard to `characters:partySummary`; the spec's Dashboard target still expected
`characters:listByCampaign`. Test-only change.

## Lorekeeper drawer reopen race (lorekeeper-flow.spec.ts:293, intermittent)

`DrawerPanel`'s `onClose` handler called `onClose()` whenever `open` was true. `dialog.close()` queues the native
`close` event; Chrome runs input first, so an Enter on the pill right after ✕ could reopen the drawer before that event
arrived, and the stale event then shut the reopened drawer. The handler now also requires the dialog to be closed
(`!ref.current?.open`), which an Escape or a real close always satisfies.
