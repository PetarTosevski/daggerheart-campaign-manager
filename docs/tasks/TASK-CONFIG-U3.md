# TASK-CONFIG-U3: Campaign settings, Players

Plan `.omc/plans/config.yaml`, wave 3, tracer U3; briefs `.omc/plans/config-briefs.md` (U1-U5 block, "User answers
2026-11-04": Q7 a, Q8 b, Q10 b; "Questions 2026-11-05": defaults); bead dcm-jh6d.17. Design
`reference/designs/config/Settings.dc.html` (`.s-players`). Built on S1 (shell, slots) and G1 (`members.setCoGm`,
`invite asCoGm`, roster `coGm`, `isCreator`). No server change.

## What landed

- **Roster** (`sections/players/roster.tsx`, design `.pl`):
  - The creator's row comes first: the 'GM' face, 'You' for the creator or the creator's name for a co-GM, then
    'Game Master' and the badge 'Owner'.
  - Then co-GMs and players, co-GMs first, each group in join order. Each row shows:
    - the face: the first character's portrait, else the member's initial;
    - the name;
    - 'plays Moss · Druid' (several characters are joined with ', '; retired, dead and corrupt ones are left out), or
      'No character yet';
    - the badge 'Co-GM';
    - the presence slot;
    - the '···' menu.
- **Menu** (Q7 a, display only; the server decides):
  - The creator gets 'Make co-GM' / 'Remove co-GM' (`members.setCoGm`) and 'Remove from campaign'.
  - A co-GM gets 'Remove from campaign' on player rows only. Co-GM rows show no menu to a co-GM.
  - 'Remove from campaign' first switches the row to 'Remove <name>?' with Remove (glass danger) and Cancel (glass
    cancel), then calls `members.removePlayer`.
  - Both mutations update the live `members.roster` optimistically (rule 12).
  - Escape and an outside click close the menu. Escape doesn't close the settings dialog.
- **Presence** (`presence.tsx`): `PresenceSlot({ campaignId, userId })` renders nothing. U3p fills it once
  `@convex-dev/presence` is approved. No package was added.
- **'Invite a player' card** (`invite.tsx` `JoinLinkCard`, design `.invite`):
  - 'Anyone with the link can join this campaign as a player.', then the full `/join/<code>` link from
    `members.access` (`data-testid="settings-join-link"`).
  - Copy link (clipboard, with a 'Copied' status for 2 s) and New link (`rotateJoinCode { replace: true }`), with the
    hint that a new link stops the old one.
  - With no code yet it shows a 'Make a link' button. A click makes the link, not an effect (rule 13).
- **Email invites** (`invite.tsx` `EmailInvites`, moved from the Players dialog):
  - The address field ('Player email') and Invite.
  - For the creator only, the 'Invite as' Player / Co-GM segmented control (Q8 b): `asCoGm: true` is sent only when
    Co-GM is picked.
  - Pending invites read '<email> · invited', with a 'Co-GM' badge for a co-GM invite, and each has Revoke.
  - Errors show inline (`role="alert"`).
- **Section** (`index.tsx`): roster, invite card, the label 'Invite by email', email invites. All buttons are
  `glassButtonClass` (neutral / tool for controls, danger for Remove and Revoke, cancel in the confirm).
- **CSS:** `players.css`, colocated. Both `invite.tsx` and `roster.tsx` import it, so the dialog gets it too.

## Decisions (defaults taken)

- **'plays …' reads `charactersReads.listByCampaign`, not `partySummary`.** The acceptance names `partySummary`, but
  that query drops `ownerId`, so it can't map a character to its player. `listByCampaign` has the same access and
  returns `ownerId`. It runs only while the Players section is open. No server change.
- **The roster names the creator 'You'** only when the viewer is the creator. The design shows 'You' because its
  viewer is the GM.
- **No auto-created join code** in the section. The dialog's effect still does it until SX.
- **Q10 b / N9 a:** the Players button stays. Pointing it at `openSettings("players")` is SX's job, since it touches
  `campaign-shell.tsx`, which U3 doesn't own.

## Out of owns (approved by the orchestrator)

- `src/app/(gm)/campaigns/[campaignId]/players-dialog.tsx`: the dialog's email form and pending list are replaced by
  `<EmailInvites campaignId>` imported from this folder, rendered only while the dialog is open. The `invite` /
  `revokeInvite` hooks are removed. Labels are unchanged ('Player email', 'Invite', '<email> · invited', 'Revoke
  invite for …'), so the ~35 specs that drive the dialog still work. Nothing else in the dialog changed. (G2 may
  touch the same file.)
- `tests/unit/config/s1-shell.test.tsx` broke as soon as a slot rendered something. The orchestrator fixed it on
  `rebuild` (6ced6199), and this branch fast-forwarded onto that fix.

## Tests

- `tests/unit/config/players.test.tsx` covers:
  - the helpers;
  - row order, badges and 'plays' lines;
  - the creator's and the co-GM's menus;
  - the remove confirm and Cancel;
  - Escape closing the menu;
  - the optimistic patches;
  - loading;
  - Copy link / Copied / New link / Make a link;
  - 'Invite as' (creator only, `asCoGm` sent);
  - the pending Co-GM badge and Revoke;
  - the standalone `EmailInvites`, which keeps the dialog's labels.
- `tests/e2e/config-players.spec.ts` has two tests:
  - The creator makes the player a co-GM. The co-GM gets the gear live, sees Owner and their Co-GM badge, and has no
    'Make co-GM' / 'Remove co-GM', no menu on their own row and no 'Invite as'. Then the creator demotes them and the
    gear goes. The remove confirm's Cancel keeps the player. The test also runs axe on the panel and checks 390 px.
  - The creator invites a fresh email as co-GM. The pending row is marked Co-GM. That account opens the campaign and
    gets the gear, and the creator's roster shows them as Co-GM.

Shots: `test-results/config-u3/` and `/mnt/c/Users/Petar/Downloads/dcm-screens/config-u3/`.
