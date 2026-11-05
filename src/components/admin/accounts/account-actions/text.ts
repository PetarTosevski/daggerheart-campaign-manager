/**
 * App admin, Accounts: suspend and delete accounts (config AU9 on AD14; N11). The words of the row's menu, its confirm
 * dialog and the row's marks, and the small pure helpers the components and their tests share.
 */

/** convex/adminAccountActions.ts ACCOUNT_REASON_MAX (the server refuses a longer reason with INVALID). */
export const REASON_MAX = 300;

export const SUSPEND = "Suspend";
export const LIFT = "Lift suspension";
export const DELETE = "Delete account";
export const UNDO_DELETE = "Undo delete";
export const UNDO = "Undo";
export const SUSPENDED_TAG = "Suspended";
export const CANCEL = "Cancel";

export type ConfirmKind = "suspend" | "delete";

/** The confirm dialog's words for one account (`name` is what the row shows). */
export function confirmText(kind: ConfirmKind, name: string) {
  if (kind === "suspend") {
    return {
      title: `Suspend ${name}?`,
      body: "They are signed out everywhere and can’t sign in. Nothing is deleted, and their campaigns stay playable for everyone else. You can lift the suspension any time.",
      action: SUSPEND,
    };
  }
  return {
    title: `Delete ${name}’s account?`,
    body: "They are signed out at once and the account is erased in 30 days; until then you can undo it. Their campaigns go to a co-GM, or are deleted if there is none. Their characters in other campaigns stay as “Former player”.",
    action: DELETE,
  };
}

export const REASON_LABEL = "Reason";
export const REASON_HINT = "Kept in the admin log.";

/** The label of the type-the-email field. */
export function emailLabel(email: string): string {
  return `Type ${email} to confirm`;
}

/** Whether what was typed is the account's email (case and surrounding spaces aside, as the server compares). */
export function emailMatches(typed: string, email: string | null): boolean {
  return email !== null && typed.trim().toLowerCase() === email.trim().toLowerCase();
}

const DAY = 24 * 60 * 60 * 1000;

/** "Deleted in 30 days" / "Deleted in 1 day" / "Deleted today" (whole days left, rounded up). */
export function deleteInText(deleteAfter: number, now: number): string {
  const days = Math.ceil((deleteAfter - now) / DAY);
  if (days <= 0) return "Deleted today";
  return days === 1 ? "Deleted in 1 day" : `Deleted in ${days} days`;
}
