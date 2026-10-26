// The adversary-action engine (plan combat-actions, tracer AA1): attack rolls and damage, damage to PCs with Armor Slots,
// feature requirements / passives / triggers / spotlight, and the reaction window. Pure, framework-free, relative
// imports only (bundled into Convex). The feature runner is src/lib/domain/adversary-effects/run.ts.
// API: docs/tasks/TASK-CA-AA1.md.

export * from "./attack";
export * from "./severity";
export * from "./features";
export * from "./window";
