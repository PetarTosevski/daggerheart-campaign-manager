import type { AccountRow } from "../account-table";

/**
 * The account-actions slot in the account row's '···' menu (config AU2 leaves it empty). Tracer AU9 fills it with
 * Suspend / Lift suspension and Delete account once Q28's design is approved (N11), keeping this name and these props.
 * It renders menu items (`role="menuitem"` buttons) after Add to / Remove from testers; `onDone` closes the menu.
 * The owner's own row has no menu, so it never mounts there.
 */
export type AccountActionsProps = { account: AccountRow; onDone: () => void };

export function AccountActions(props: AccountActionsProps) {
  void props;
  return null;
}
