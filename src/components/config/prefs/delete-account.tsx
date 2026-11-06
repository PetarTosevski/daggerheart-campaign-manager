"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";

export const DELETE_ACCOUNT_TEXT = {
  item: "Delete account",
  title: "Delete your account?",
  body:
    "You'll be signed out on every device at once. Your account and everything in it are erased after 30 days. " +
    "Changed your mind? Sign in again within those 30 days and the deletion is cancelled.",
  confirm: "Delete my account",
  cancel: "Keep my account",
  busy: "Deleting …",
} as const;

/**
 * 'Delete account' in the Preferences popover (plan account-deletion DEL1; App Store 5.1.1(v)). A confirm step explains
 * the 30-day window and that signing in again cancels it, then `accountSelfDelete.deleteMyAccount` signs the account out
 * everywhere and this browser goes to /signin. The app owner can't delete their account (the server refuses with
 * OWNER_ACCOUNT_UNDELETABLE), so the item is hidden for them; it is also hidden while `appAdmin.me` loads.
 */
export function DeleteAccountItem(): ReactNode {
  const me = useQuery(api.appAdmin.me);
  if (me === undefined || me === null || me.isOwner) return null;
  return <DeleteAccountRow />;
}

/** The button, then the confirm step. */
function DeleteAccountRow(): ReactNode {
  const deleteMyAccount = useMutation(api.accountSelfDelete.deleteMyAccount);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount({});
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
      return;
    }
    // The server already ended every session; this clears this browser's tokens.
    await signOut();
    router.push("/signin");
  };

  if (!confirming) {
    return (
      <div className="cfg-row">
        <BrandButton variant="danger" size="sm" className="flex-1" onClick={() => setConfirming(true)}>
          {DELETE_ACCOUNT_TEXT.item}
        </BrandButton>
      </div>
    );
  }

  return (
    <div className="cfg-row cfg-col" role="group" aria-labelledby={titleId}>
      <div className="cfg-row-t">
        <b id={titleId}>{DELETE_ACCOUNT_TEXT.title}</b>
        <span>{DELETE_ACCOUNT_TEXT.body}</span>
      </div>
      <div className="flex gap-2">
        <BrandButton variant="neutral" size="sm" className="flex-1" disabled={busy} onClick={() => setConfirming(false)}>
          {DELETE_ACCOUNT_TEXT.cancel}
        </BrandButton>
        <BrandButton variant="danger" size="sm" className="flex-1" disabled={busy} onClick={() => void confirm()}>
          {busy ? DELETE_ACCOUNT_TEXT.busy : DELETE_ACCOUNT_TEXT.confirm}
        </BrandButton>
      </div>
      {error ? (
        <p role="alert" className="cfg-muted cfg-prefs-err">
          {error}
        </p>
      ) : null}
    </div>
  );
}
