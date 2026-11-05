/**
 * Rule switches (plan rule-switches, epic dcm-jh6d part A): the registry and the resolver. Pure; Convex imports it with
 * relative paths. Engine code reads a mode only through `ruleModesOf(campaign)` (convex/lib/ruleModes.ts), which wraps
 * `resolveRuleModes`. Guide: docs/tasks/TASK-RULES-RS0.md.
 */
export * from "./registry";
export * from "./resolve";
