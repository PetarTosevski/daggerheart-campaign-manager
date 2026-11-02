/**
 * The Combat HUD (plan .omc/plans/combat-hud.yaml; design reference/designs/combat-hud/, HANDOFF.md). What the
 * Combat Map page mounts: the opt-in switch (answer 11b), the HUD shell and the drawer's header row. Every HUD part
 * lives in its own folder under hud/ and is mounted by the shell, never by the page.
 */
export { useHudEnabled } from "./flag";
export { HudShell } from "./shell";
export type { HudShellProps } from "./shell";
export { HudSwitchButton, ToolsHead } from "./tools";
