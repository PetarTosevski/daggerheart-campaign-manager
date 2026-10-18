# Design port decisions for D2.5–D11 (user, 2026-10-17)
- Frame mechanics: build trackers too (rules from the books: Core Book frames, Hope & Fear frames).
- Hope & Fear expansion content: per-campaign switch, default on for the 4 H&F frames (Castle High, Weredragon, Andaluria, Horizon).
- Automation: automate per the books (Fear rolls give GM Fear, crits, class/Hope features, Rally/Prayer resets), with undo.
- Death moves: implement per the Core Book (Blaze of Glory, Avoid Death + scar roll, Risk It All), manual override stays.
- Resolved from books: Battle Points table = Core Book; Prayer Dice use Spellcast trait; Rally once per session, unspent cleared at session end.
- Rulebooks: .reference-private/ (git-ignored); re-extract text with pdfjs-dist when needed (never commit the books).
- Photo import: build at end of D5 — Convex action calling Claude vision with ANTHROPIC_API_KEY env var on Convex; mandatory GM review before save; button hidden without key.
- Rests & downtime: build per Core Book in D5 (rest flow, downtime moves applied, GM Fear on rests per book); Sessions keeps tallies.
- Travel: keep the board's speeds as the user's HOUSE RULE (GM-editable per campaign). For Journey to Horizon, the book's hex crawl takes priority wherever it conflicts.
- Custom campaign map: GM uploads a map image + width in km.
- D8: catalogue + live encounter tracker (instances, HP/Stress, conditions, BP budget, Spend Fear via dashboard Fear).
- Frame trackers: build EVERY stateful frame mechanic from its book chapter (D3); narrative-only mechanics stay text.
- Notes: NO PINs. Each user has their own account and their own journal.
- MULTI-USER (major change): the app is no longer single-GM. Players have their own accounts. Everything marked hidden-from-players must be invisible to players (server-enforced, not just UI). Supersedes AGENTS.md "single GM account" principle and the allowlist-only sign-in.
- Backup: per-campaign JSON export (including images); import creates a new campaign (no overwrite).
- Sign-in: Google AND email+password sign-up, both limited for now to an env allowlist (ALLOWED_EMAILS, replacing GM_EMAILS); plus optional env-defined pre-made accounts for testing. One later switch opens sign-up to everyone.
- Roles: per campaign. Any account can create campaigns (it is their GM) and be a player in others.
- Joining: GM invites by email AND a join code/link; GM can remove players.
- Players: full control of their own character (create/edit, dice, Hope/class features, level up, rest); GM edits all characters; players see other PCs' public info only.
- Players see: dashboard (party, time, revealed info, last session), GM Fear and countdowns (read-only), World map (non-hidden tokens) + revealed Codex, lore books. Never: hidden tokens, unrevealed NPCs/images/allegiances, GM notes, adversaries/encounters, session prep, others' journals.
- Five Banners: relationships + objectives GM-only with per-item reveal; a Five Banners week counter with "Advance week".
- Colossus: Kudamat's Power + Siphoning Track GM-only.
- Horizon Doom Track: GM-only; events the GM marks "occurred" become visible to players.
- Optional frame rules (Castle High less-lethal, Andaluria transformations, Horizon Endurance Countdowns, Motherboard remnant Corruption): on in their frame by default, GM can toggle; transformations need player consent.
- Subagents run on Opus.
- D4 characters: the GM can create a character for a player and assign it later (or leave it unassigned); players create their own too.
- Players can open other players' characters as full sheets, read-only.
- Creation wizard: all 9 steps required, as designed (the create button lists what's missing).
- Wither tokens (D5): book rule automated — gaining a token rolls the Fear Die; at or below the PC's tokens → scar and clear tokens; undo available; no per-PC cap (pool of 20 shown for reference).
- End-of-session Wither → Fear conversion caps GM Fear at 12 and shows "N Fear lost".
- Permissions (2026-10-18): one `files` table owns every upload (map, codex image, portrait), and a `grants` join table (resource, principal user|campaign, permission view|edit|owner) is added now as the base for sharing maps and other resources later. Access = strongest of the campaign role and any grant; a view grant gets the player view.
- Defaults accepted by the user (2026-10-18, "use defaults for all"):
  - Seed accounts: allowed on the cloud dev deployment too, never production; gated by an explicit env flag set only on dev.
  - Email invites: only verified (Google) accounts; the GM players dialog tells the GM that password accounts must join by code.
  - History: Fear, countdown and campaign-time changes get their own history tables before the operations table gets its 7-day TTL.
  - Horizon questions (dcm-bxp.20) stay open.
- D5 decisions (defaults, 2026-10-18):
  1. Players roll their own dice; the server rolls, every roll goes to a feed all members see; physical-dice results can be entered and are marked manual.
  2. GM free rolls are hidden unless the GM reveals them; player character rolls are public.
  3. 3D dice on by default, lazy-loaded, off when the device asks for reduced motion; toggle and sound saved per device.
  4. Level-up undo: only the latest level, repeatable, plus a GM correction mode that sets the level directly.
  5. The GM's "Party levels up" flags everyone; each owner then levels up their own character.
  6. Strange Patterns: when both dice show the number, one benefit only (player picks Hope or clear a Stress).
  7. Actions on another player's character (Life Support, Rally, healing/repairing an ally, Prepare together) are allowed only through those actions and logged on both characters; no target confirmation.
  8. "Until hit" effects: a manual "Got hit" button until the D8 encounter tracker reports hits.
  9. Unconscious, dead or away characters: roll and feature buttons disabled.
  10. Rests: the GM starts a party rest, each player picks 2 moves, the GM finishes it; no solo rests.
  11. Subclass features: text in D5 plus always-on numeric bonuses; full automation is a follow-up bead.
  12. Start/End session: temporary GM buttons on the dashboard until the Sessions board (D9).
  13. Photo import: GM only; photos deleted after reading.
  14. Photo import model: fixed default overridable by ANTHROPIC_MODEL; one call per click, no automatic retry.
  - Rules settled from the books (not choices): advantage cancels one-for-one to a single d6 (help: keep highest); Brawler crit = 14 × Proficiency + roll; Avoid Death scar on Hope Die ≤ level and last Hope slot flags the character's journey ending for the GM; Witch's Charm costs 3 Hope and gives the GM 1 Fear only when the roll was with Hope (removing that Hope); experiences usable on reaction rolls (cost Hope), reaction rolls generate no Hope/Fear; Fear from rolls/rests/scars applied automatically with undo; rest Fear 1d4 short, 1d4 + PCs long; at most three short rests before a long rest; Work on a Project ticks a progress countdown or the GM asks for a roll; two level-up picks per level (Proficiency and Multiclass take both), trait marks clear at 5 and 8, optional equal-or-lower card trade; multiclass from level 5, class feature only, domain cards up to half level rounded up, crosses out mastery and other multiclass; Prayer Dice = Spellcast trait d4s, 0 if ≤ 0; Wither token on Severe damage from a Withered source then Fear Die ≤ tokens = scar and clear, session end converts tokens to Fear; Castle High "away" characters are left out of rests and Fear counts.
- D7 decisions (defaults, 2026-10-18): players see an entry's role / kind of place; starting NPCs are created automatically per frame (secret); frames other than Witherwild use Allies / Enemies / Neutral with no regions; revealing an image marks the entry known.
- Campaign purge (2026-10-18): built and tested but not scheduled; deleted campaigns stay restorable until a GM 'Delete permanently' action exists. Daily jobs expire operations (7 days) and orphan uploads (2 hours).
- Weredragon (2026-10-18): "Roll the night sky" is a Weredragon-only feature: any member can roll the 5d6 (HF p.140), the GM assigns.
