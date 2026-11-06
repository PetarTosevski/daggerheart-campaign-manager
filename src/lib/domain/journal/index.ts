/**
 * Journal domain (plan `.omc/plans/journal.yaml`, J0): a session's live windows, the merged session log, scene
 * progress and per-scene encounters, the Spotlight line and the hours at the table. Pure TypeScript with structural
 * input types, shared by Convex and the browser.
 *
 * Server: windowsFromMarks(marks, session, now) via `liveWindows` (convex/lib/sessions.ts); mergeLog(sources) (JD2);
 *   sceneEncounterId(scene, index, prep) (JD4); hoursAtTable(sessions) (JD5).
 * Client: nextSceneId(scenes) (JP1), leastSpotlightLine(entries) (JT), hoursAtTable (JS).
 */

export * from "./windows";
export * from "./log";
export * from "./scenes";
export * from "./summary";
export * from "./tally";
