/**
 * The Combat HUD (plan .omc/plans/combat-hud.yaml; design reference/designs/combat-hud/, HANDOFF.md). What the
 * Combat Map page mounts in Play: the HUD shell and the drawer's header row (plan combat-hud H8.1: the HUD is the only
 * Combat Map; the opt-in switch is gone). Every HUD part lives in its own folder under hud/ and is mounted by the
 * shell, never by the page.
 */
export { HudShell } from "./shell";
export type { HudShellProps } from "./shell";
export { ToolsHead } from "./tools";
