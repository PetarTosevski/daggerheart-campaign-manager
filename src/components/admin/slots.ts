/**
 * The tabs of App admin (`/admin`, the app owner only): plan `.omc/plans/config.yaml` Part B, briefs
 * `.omc/plans/config-briefs.md`, design `reference/designs/config/Admin.dc.html`. Tracer AD1 owns the shell
 * (`shell/**`: the header, the tab list, the URL state, the owner gate) and this contract; each feature tracer owns only
 * its tab's folder and fills the component it exports, keeping the name and the props:
 *
 * | File                         | Tracer      | Export (what the shell mounts in the tab panel) |
 * |------------------------------|-------------|-------------------------------------------------|
 * | `overview/index.tsx`         | AU1         | `OverviewTab` (Overview)                        |
 * | `accounts/index.tsx`         | AU2         | `AccountsTab` (Accounts)                        |
 * | `lorekeeper/index.tsx`       | AU3         | `LorekeeperTab` (Lorekeeper)                    |
 * | `features/index.tsx`         | AU4         | `FeatureSwitchesTab` (Feature switches)         |
 * | `maintenance/index.tsx`      | AU5         | `MaintenanceTab` (Maintenance)                  |
 *
 * Every tab gets `AdminTabProps`.
 *
 * Page (design `.adm-h` + `.adm`): the header (back to the main menu, the wordmark, the 'Owner only' badge; kicker
 * 'Whole app · every campaign', H1 'App admin', the sub line, 'Saved · changes apply right away'), then the tab list
 * 'Admin sections' on the left (the design's side nav, ARIA tabs with a vertical orientation) and the tab panel.
 *
 * Owner gate: the shell reads `appAdmin.me` (`{ isOwner }` for the caller, AD0) through `useAppOwner`
 * (`shell/owner.ts`). Only when `isOwner` does it render the tabs, so no tab's query ever runs for anyone else; a
 * signed-in non-owner gets 'Not allowed' (Q17 changed) and a signed-out visitor is sent to sign-in by `src/proxy.ts`
 * like every (gm) page. That gate is UX only (CF22): every admin function checks the owner on the server
 * (`appOwnerQuery` / `appOwnerMutation` / `appOwnerAction`, AD0), and a tab must never rely on the shell for access.
 *
 * URL state: `?tab=overview|accounts|lorekeeper|features|maintenance` (absent or a bad value = Overview; choosing
 * Overview removes the param, every other param stays). The shell writes it with `history.replaceState`, which Next's
 * router syncs into `useSearchParams` without a server round trip.
 *
 * Rules for every tab:
 * - The shell wraps the tab in its own error boundary (CL1, rule 11) and mounts only the selected tab, so the other
 *   tabs' queries don't run. A tab shows its own loading line (`<p role="status" className="adm-muted">Loading …</p>`)
 *   while its `useQuery` is `undefined`. A stub renders nothing until its tracer lands.
 * - Cards are `<section className="adm-card">` with `adm-card-h` (H3 + the board's hint line); the shared classes live
 *   in `admin.css` (`adm-card`, `adm-card-h`, `adm-row`, `adm-row-t`, `adm-muted`); a tab adds CSS only in a colocated
 *   `.css` in its folder.
 * - Writes are single-field intents with an optimistic update (rule 12); every admin mutation is logged on the server
 *   (AD0's `recordAdminChange`). Buttons are arcane glass (`BrandButton` / `glassButtonClass`: `neutral` / `tool` for
 *   settings controls, `confirm` / `cancel` in a confirm step, `danger` for Suspend and Delete).
 */

// ---------------------------------------------------------------- URL state

/** The admin tabs, in nav order. */
export type AdminTab = "overview" | "accounts" | "lorekeeper" | "features" | "maintenance";

export const ADMIN_TABS: readonly { id: AdminTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "accounts", label: "Accounts" },
  { id: "lorekeeper", label: "Lorekeeper" },
  { id: "features", label: "Feature switches" },
  { id: "maintenance", label: "Maintenance" },
];

/** The search param that holds the selected tab. */
export const ADMIN_TAB_PARAM = "tab";

/** The tab a `?tab=` value selects: Overview when the param is absent or not a tab. */
export function parseAdminTab(value: string | null | undefined): AdminTab {
  return ADMIN_TABS.find((t) => t.id === value)?.id ?? "overview";
}

/** The URL (path + query) with `tab` selected (Overview removes the param); every other param stays. */
export function adminTabUrl(pathname: string, search: string, tab: AdminTab): string {
  const query = new URLSearchParams(search);
  if (tab === "overview") query.delete(ADMIN_TAB_PARAM);
  else query.set(ADMIN_TAB_PARAM, tab);
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}

// ---------------------------------------------------------------- text

export const ADMIN_TITLE = "App admin";
export const ADMIN_KICKER = "Whole app · every campaign";
export const ADMIN_SUB = "Limits, costs and switches for the app. GMs and players never see this page.";
export const ADMIN_OWNER_BADGE = "Owner only";
export const ADMIN_SAVED = "Saved · changes apply right away";

export const NOT_ALLOWED_TITLE = "Not allowed";
export const NOT_ALLOWED_TEXT = "This page is for the app owner.";

// ---------------------------------------------------------------- slot props

/** Every admin tab. `onTab` selects another tab (an Overview alert can point at Lorekeeper, for example). */
export type AdminTabProps = { onTab: (tab: AdminTab) => void };
