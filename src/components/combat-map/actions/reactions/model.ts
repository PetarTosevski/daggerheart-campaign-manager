// The incoming-hit model moved to src/lib/combat-map/reactions.ts (shared with the phone app). This re-export stays for
// importers outside tracer WSM's files (combat-map/hud/hit/*, tests/convex/lane-e2-window.test.ts); point them at
// src/lib and delete this file.
export * from "@/lib/combat-map/reactions";
