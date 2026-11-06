/**
 * Fixture problems the harness lets through: `function $.path: problem`, exactly as the harness
 * reports them. Any problem not listed here fails the test.
 *
 * PX16 (dcm-gdzi.39) started with 188 stale lines; PXL (dcm-gdzi.49) fixed the fixtures (complete records
 * come from `records.ts`). What is left is deliberate: players/roles.test.tsx feeds the Players screen a
 * roster the server could never send, to show that the screen says "The roster could not be read."
 *
 * This list may only shrink: fix the fixture (in the test that owns it) and delete its lines.
 * Never add a line; a new or changed fixture must match the validator. `fixture-validators.test.tsx`
 * caps the length and drops lines whose function is gone.
 */
export const KNOWN_STALE_FIXTURES: readonly string[] = [
  "members:roster $.bad: not in the validator",
  "members:roster $.gm: missing (required)",
  "members:roster $.players: missing (required)",
  "members:roster $.viewer: missing (required)",
];

/** The list's length now; lower it as lines go, never raise it. */
export const KNOWN_STALE_FIXTURES_CAP = 4;
