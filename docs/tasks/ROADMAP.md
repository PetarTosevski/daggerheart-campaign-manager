# Witherwild Campaign Manager — Tasks 008–016

## Sequence

```text
008 — Week Advancement
009 — Persistent Campaign Timeline
009A — Campaign Creation & Initialization (Complete)
010 — Character Workspace and Creation Foundation
011A — PDF Template Storage and Rendering (Complete)
011B — Sheet Template Editor (Complete)
011C — Interactive Character Sheet Runtime (Complete)
012 — Character Food System (Complete)
013 — Character Inventory System (Complete)
014 — Wither Token System
015 — Character Asset and Media Library
016 — Dice Engine and Roll History
```

## Dependency flow

```text
008 Week Advancement
  ↓
009 Persistent Timeline and Shared App Shell
  ↓
009A Campaign Creation & Initialization
  ↓
010 Character Workspace
  ↓
011A PDF Storage and Rendering
  ↓
011B Template Editor
  ↓
011C Interactive Runtime
  ↓
012 Food
  ↓
013 Inventory
  ↓
014 Wither
  ↓
015 Assets and Media
  ↓
016 Dice and Roll History
```

## Global rules

- Use Supabase migrations for every schema change.
- Scope every record to a campaign.
- Test RLS explicitly.
- Preserve uploaded PDFs and media as immutable source assets.
- Store character-sheet values as structured data, not inside PDFs.
- Food, Inventory, Wither, and Dice are authoritative domain systems.
- Character-sheet fields display or control those domains through adapters.
- Complete and verify one task before starting the next.

## Standard verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
