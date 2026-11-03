// Planned scenes in the Journal's Plan view (Journal J0; JD4 and JP1 use these). Pure module.
//
// Q7 (user 2026-11-03): starting a scene's encounter on the Combat Map marks it Playing now; the scene that was
// playing becomes Done; "Next" is the first scene after the playing one that is not done. The GM marks non-combat
// scenes. Q6: one encounter per Combat scene; a session's legacy encounter (`sessionPrep.encounterId`, D10 Q1) reads
// as the first Combat scene's (no migration).
//
// ```ts
// nextSceneId([{ id: "a", state: "done" }, { id: "b", state: "playing" }, { id: "c", state: "done" }, { id: "d" }]); // "d"
// ```

/** A scene as these helpers read it (`sessionSceneValidator`, convex/lib/validators/sessions.ts). */
export type JournalScene<EncounterId extends string = string> = {
  id: string;
  type: "combat" | "social" | "exploration" | "downtime";
  state?: "planned" | "playing" | "done";
  encounterId?: EncounterId;
};

/**
 * The id of the scene shown as "Next": the first scene after the playing one that is not done; without a playing
 * scene, the first scene that is not done. Null when every remaining scene is done (or there are none).
 */
export function nextSceneId(scenes: readonly Pick<JournalScene, "id" | "state">[]): string | null {
  const playing = scenes.findIndex((s) => s.state === "playing");
  const next = scenes.find((s, i) => i > playing && s.state !== "done" && s.state !== "playing");
  return next?.id ?? null;
}

/**
 * The encounter of the scene at `index` (Q6): its own `encounterId`; else, for the first Combat scene, the session's
 * legacy encounter (`prep.encounterId`); else undefined. Non-combat scenes never get the legacy encounter.
 */
export function sceneEncounterId<EncounterId extends string>(
  scene: JournalScene<EncounterId>,
  index: number,
  prep: { scenes: readonly Pick<JournalScene, "type">[]; encounterId?: EncounterId },
): EncounterId | undefined {
  if (scene.encounterId !== undefined) return scene.encounterId;
  if (scene.type !== "combat" || prep.encounterId === undefined) return undefined;
  return prep.scenes.findIndex((s) => s.type === "combat") === index ? prep.encounterId : undefined;
}
