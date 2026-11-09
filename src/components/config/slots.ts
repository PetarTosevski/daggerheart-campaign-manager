import type { Id } from "../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../convex/campaigns";

/**
 * The slots of Campaign settings (the gear, GM and co-GM) and Preferences (the avatar, everyone): plan
 * `.omc/plans/config.yaml`, briefs `.omc/plans/config-briefs.md`, design `reference/designs/config/Settings.dc.html`.
 * Tracer S1 owns the shell (`shell/**`: the slide-over, the popover, the URL state, the context) and the two buttons in
 * `src/components/app-bar/account.tsx`; each feature tracer owns only its file or folder and fills the component it
 * exports, keeping the name and the props:
 *
 * | File / folder                       | Tracer        | Export (where the shell mounts it)                                 |
 * |-------------------------------------|---------------|--------------------------------------------------------------------|
 * | `sections/table/index.tsx`          | U1            | `TableSection` (settings, Table: under the H3 'At the table')       |
 * | `sections/rules/index.tsx`          | U2            | `HouseRulesSection` (settings, House rules: under 'House rules')    |
 * | `sections/expansions/index.tsx`     | 2026-11-09    | `ExpansionsSection` (settings, Expansions: Hope & Fear content)     |
 * | `sections/players/index.tsx`        | U3 (U3p)      | `PlayersSection` (settings, Players: under 'Players')               |
 * | `sections/lorekeeper/index.tsx`     | U4 (AU3, AU8) | `LorekeeperSection` (settings, Lorekeeper: under 'Lorekeeper')      |
 * | `sections/sessions/index.tsx`       | U5 (S3)       | `SessionsSection` (settings, Sessions: under 'Sessions')            |
 * | `prefs/index.tsx`                   | U6a           | `PreferenceRows` (Preferences popover, under the account label)    |
 * | `prefs/admin-link.tsx`              | AU6           | `AppAdminLink` (Preferences popover, after the rows; owner only)    |
 * | `presence-beat.tsx`                 | U3p           | `PresenceBeat` (mounted once in the campaign shell, renders nothing)|
 * | `spotlight-ping.tsx`                | U6d           | `SpotlightPing` (mounted once in the campaign shell)                |
 *
 * Props: every settings section gets `SettingsSectionProps`; `PreferenceRows` and `AppAdminLink` get
 * `PreferencesSlotProps`; `PresenceBeat` gets `PresenceBeatProps`; `SpotlightPing` gets `SpotlightPingProps`.
 *
 * Settings panel (design `.setp`, 640 px): a native modal `<dialog>` on the right (focus trapped, Escape and the
 * backdrop close it, no slide with reduced motion). Kicker '<campaign name> · GM only', H2 'Campaign settings', the side
 * nav 'Settings sections' (Table / House rules / Expansions / Players / Lorekeeper / Sessions, the current one `aria-current`), the
 * section (the shell renders the H3 from `SETTINGS_SECTIONS[].title`; the slot renders the rows under it, the board's
 * hint line included) and the footer 'Changes save as you make them and reach every player at once.'. Only the GM
 * (`campaign.role === "gm"`: creator and co-GM) ever gets the panel; a player with `?settings=` in the URL sees nothing.
 *
 * Preferences popover (design `.pm-pop`): a native `popover="auto"` (light dismiss, Escape, top layer) with
 * `role="dialog"`: the avatar, the account's name and 'Game Master' / 'Player' · campaign, the label
 * `PREFERENCES_SAVED_LABEL`, `PreferenceRows`, `AppAdminLink`, then 'Campaign settings' (GM) and 'Sign out'. Its body
 * renders only while it is open, so the slots' queries run only then.
 *
 * URL state: `?settings=table|rules|expansions|players|lorekeeper|sessions` opens the panel at that section (a bad value opens
 * Table); closing removes the param, every other param stays. The shell writes it with `history.replaceState`, which
 * Next's router syncs into `useSearchParams` without a server round trip.
 *
 * Rules for every slot:
 * - The shell wraps each slot in its own `SlotBoundary` (CL1, rule 11); a slot shows its own loading line
 *   (`<p role="status" className="cfg-muted">Loading …</p>`) while its `useQuery` is `undefined`. A stub renders
 *   nothing until its tracer lands.
 * - Settings rows read the live `campaigns.get` (`props.campaign`, the shell's subscription): a change reaches every
 *   member at once without a new subscription. Writes are single-field intents (`{ change: { key, value } }`) with an
 *   optimistic update (rule 12).
 * - Styles: shared row classes in `config.css` (`cfg-row`, `cfg-row-t`, `cfg-hint`, `cfg-lbl`, `cfg-muted`, `cfg-sw`,
 *   `cfg-seg`); a feature adds CSS only in a colocated `.css` in its folder. Buttons are arcane glass
 *   (`BrandButton` / `glassButtonClass`: `neutral` / `tool` for settings controls, `confirm` / `cancel` in a confirm
 *   step, `danger` for Archive and Remove).
 */

// ---------------------------------------------------------------- URL state

/** The settings sections, in nav order. */
export type SettingsSection = "table" | "rules" | "expansions" | "players" | "lorekeeper" | "sessions";

export const SETTINGS_SECTIONS: readonly { id: SettingsSection; label: string; title: string }[] = [
  { id: "table", label: "Table", title: "At the table" },
  { id: "rules", label: "House rules", title: "House rules" },
  { id: "expansions", label: "Expansions", title: "Expansions" },
  { id: "players", label: "Players", title: "Players" },
  { id: "lorekeeper", label: "Lorekeeper", title: "Lorekeeper" },
  { id: "sessions", label: "Sessions", title: "Sessions" },
];

/** The search param that holds the open settings section. */
export const SETTINGS_PARAM = "settings";

/** The section a `?settings=` value opens: null when the param is absent (closed); any other value opens Table. */
export function parseSettingsSection(value: string | null | undefined): SettingsSection | null {
  if (value === null || value === undefined) return null;
  return SETTINGS_SECTIONS.some((s) => s.id === value) ? (value as SettingsSection) : "table";
}

/** The URL (path + query) with the settings param set to `section`, or removed for null; every other param stays. */
export function settingsUrl(pathname: string, search: string, section: SettingsSection | null): string {
  const query = new URLSearchParams(search);
  if (section === null) query.delete(SETTINGS_PARAM);
  else query.set(SETTINGS_PARAM, section);
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}

// ---------------------------------------------------------------- text

export const SETTINGS_TITLE = "Campaign settings";
export const SETTINGS_FOOTER = "Changes save as you make them and reach every player at once.";
export const PREFERENCES_SAVED_LABEL = "Saved to your account · follows you to every device";

// ---------------------------------------------------------------- slot props

/** Every settings section. `campaign` is the shell's live `campaigns.get` (role is always "gm" here). */
export type SettingsSectionProps = { campaign: CampaignSummary };

/** The Preferences popover's slots. */
export type PreferencesSlotProps = { campaignId: Id<"campaigns">; isGm: boolean };

/** The presence heartbeat (U3p), mounted once per campaign page. */
export type PresenceBeatProps = { campaignId: Id<"campaigns"> };

/** The spotlight chime and toast (U6d), mounted once per campaign page. */
export type SpotlightPingProps = { campaignId: Id<"campaigns">; isGm: boolean };
