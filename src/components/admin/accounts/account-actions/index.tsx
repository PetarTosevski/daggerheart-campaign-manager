"use client";

import "./account-actions.css";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { useId, useState, type FormEvent } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { AccountRow } from "../account-table";
import { accountName } from "../text";
import {
  CANCEL,
  confirmText,
  DELETE,
  deleteInText,
  emailLabel,
  emailMatches,
  LIFT,
  REASON_HINT,
  REASON_LABEL,
  REASON_MAX,
  SUSPEND,
  SUSPENDED_TAG,
  UNDO,
  UNDO_DELETE,
  type ConfirmKind,
} from "./text";

/**
 * Suspend / Lift suspension and Delete account / Undo in the account row (config AU9 on AD14, N11). `AccountActions`
 * fills the '···' menu's slot (AU2): menu items (`role="menuitem"`) after Add to / Remove from testers; `onDone` closes
 * the menu. `AccountStatusMark` shows "Suspended" or "Deleted in N days · Undo" on the row. The owner's own row has
 * no menu, and the server refuses the owner as a target anyway. Suspend and Delete open a confirm dialog that needs a
 * reason and the account's email typed again; Lift and Undo are one click. Every write is an intent with an
 * optimistic update of `adminAccountActions.statuses` (rule 12).
 */
export type AccountActionsProps = { account: AccountRow; onDone: () => void };

type Statuses = FunctionReturnType<typeof api.adminAccountActions.statuses>;
type Status = Statuses[number];

const DELETE_WAIT_MS = 30 * 24 * 60 * 60 * 1000;

/** Rewrites one account's entry in the statuses list (a missing list is left alone, the server answers soon). */
function patchStatus(store: OptimisticLocalStore, userId: Id<"users">, change: (status: Status) => Status) {
  const list = store.getQuery(api.adminAccountActions.statuses, {});
  if (list === undefined) return;
  const current = list.find((s) => s.userId === userId) ?? { userId, suspended: false, deleteAfter: null };
  const next = change(current);
  const rest = list.filter((s) => s.userId !== userId);
  store.setQuery(api.adminAccountActions.statuses, {}, next.suspended || next.deleteAfter !== null ? [...rest, next] : rest);
}

/** The four writes, each with its optimistic update. */
function useAccountWrites() {
  const suspend = useMutation(api.adminAccountActions.suspend).withOptimisticUpdate((store, { userId }) =>
    patchStatus(store, userId, (s) => ({ ...s, suspended: true })),
  );
  const unsuspend = useMutation(api.adminAccountActions.unsuspend).withOptimisticUpdate((store, { userId }) =>
    patchStatus(store, userId, (s) => ({ ...s, suspended: false })),
  );
  const scheduleDelete = useMutation(api.adminAccountActions.scheduleDelete).withOptimisticUpdate((store, { userId }) =>
    patchStatus(store, userId, (s) => ({ ...s, deleteAfter: Date.now() + DELETE_WAIT_MS })),
  );
  const cancelDelete = useMutation(api.adminAccountActions.cancelDelete).withOptimisticUpdate((store, { userId }) =>
    patchStatus(store, userId, (s) => ({ ...s, deleteAfter: null })),
  );
  return { suspend, unsuspend, scheduleDelete, cancelDelete };
}

/** This account's status, null when it is a normal account, undefined while loading. */
function useAccountStatus(userId: Id<"users">): Status | null | undefined {
  const list = useQuery(api.adminAccountActions.statuses, {});
  if (list === undefined) return undefined;
  return list.find((s) => s.userId === userId) ?? null;
}

/** The menu items for one account; nothing until the statuses load (which items apply depends on them). */
export function AccountActions({ account, onDone }: AccountActionsProps) {
  const status = useAccountStatus(account.userId);
  const writes = useAccountWrites();
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (status === undefined || account.role === "owner") return null;

  const userId = account.userId;
  const deleting = status?.deleteAfter != null;
  const suspended = status?.suspended === true;

  function oneClick(write: (args: { userId: Id<"users"> }) => Promise<null>) {
    setError(null);
    write({ userId }).then(onDone, (e: unknown) => setError(errorMessage(e)));
  }

  return (
    <>
      {deleting ? (
        <BrandButton role="menuitem" variant="cancel" size="sm" className="w-full" onClick={() => oneClick(writes.cancelDelete)}>
          {UNDO_DELETE}
        </BrandButton>
      ) : (
        <>
          {suspended ? (
            <BrandButton role="menuitem" variant="neutral" size="sm" className="w-full" onClick={() => oneClick(writes.unsuspend)}>
              {LIFT}
            </BrandButton>
          ) : (
            <BrandButton role="menuitem" variant="danger" size="sm" className="w-full" onClick={() => setConfirm("suspend")}>
              {SUSPEND}
            </BrandButton>
          )}
          <BrandButton role="menuitem" variant="danger" size="sm" className="w-full" onClick={() => setConfirm("delete")}>
            {DELETE}
          </BrandButton>
        </>
      )}
      {error ? (
        <p role="alert" className="aca-err">
          {error}
        </p>
      ) : null}
      {confirm !== null ? (
        <ConfirmDialog
          kind={confirm}
          account={account}
          onCancel={() => {
            setConfirm(null);
            onDone();
          }}
          onConfirm={(reason, confirmEmail) => (confirm === "suspend" ? writes.suspend : writes.scheduleDelete)({ userId, reason, confirmEmail })}
          onDone={() => {
            setConfirm(null);
            onDone();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The confirm step of Suspend / Delete account: what happens, a reason (required, at most 300 characters) and the
 * account's email typed again; the danger button stays off until both are given. A refusal shows in the dialog.
 */
function ConfirmDialog({
  kind,
  account,
  onCancel,
  onConfirm,
  onDone,
}: {
  kind: ConfirmKind;
  account: AccountRow;
  onCancel: () => void;
  onConfirm: (reason: string, confirmEmail: string) => Promise<null>;
  onDone: () => void;
}) {
  const words = confirmText(kind, accountName(account));
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const emailId = useId();
  const ready = reason.trim() !== "" && reason.trim().length <= REASON_MAX && emailMatches(typed, account.email) && !busy;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    onConfirm(reason.trim(), typed.trim()).then(onDone, (e: unknown) => {
      setBusy(false);
      setError(errorMessage(e));
    });
  }

  return (
    <Modal open onClose={onCancel} title={words.title}>
      {/* The row menu handles arrows and Escape for its items; keys typed here stay here (the dialog closes on Escape itself). */}
      <form className="aca-form" onSubmit={onSubmit} onKeyDown={(event) => event.stopPropagation()}>
        <p className="aca-body">{words.body}</p>
        <div className="aca-field">
          <label htmlFor={reasonId}>{REASON_LABEL}</label>
          <textarea
            id={reasonId}
            className="aca-inp"
            value={reason}
            maxLength={REASON_MAX}
            required
            aria-describedby={`${reasonId}-hint`}
            onChange={(event) => setReason(event.target.value)}
          />
          <small id={`${reasonId}-hint`}>{REASON_HINT}</small>
        </div>
        {account.email === null ? null : (
          <div className="aca-field">
            <label htmlFor={emailId}>{emailLabel(account.email)}</label>
            <input
              id={emailId}
              className="aca-inp"
              type="email"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        )}
        {error ? (
          <p role="alert" className="aca-err">
            {error}
          </p>
        ) : null}
        <div className="aca-btns">
          <BrandButton type="button" variant="cancel" size="sm" onClick={onCancel}>
            {CANCEL}
          </BrandButton>
          <BrandButton type="submit" variant="danger" size="sm" disabled={!ready}>
            {words.action}
          </BrandButton>
        </div>
      </form>
    </Modal>
  );
}

/** The row's mark: "Suspended", or "Deleted in N days · Undo" while a deletion waits; nothing for a normal account. */
export function AccountStatusMark({ account, now }: { account: AccountRow; now: number }) {
  const status = useAccountStatus(account.userId);
  const { cancelDelete } = useAccountWrites();
  const [error, setError] = useState<string | null>(null);
  if (status === undefined || status === null) return null;

  if (status.deleteAfter !== null) {
    return (
      <span className="aca-mark">
        <span className="aca-del">{deleteInText(status.deleteAfter, now)} ·</span>
        <BrandButton
          variant="cancel"
          size="sm"
          aria-label={`Undo deleting ${accountName(account)}`}
          onClick={() => {
            setError(null);
            cancelDelete({ userId: account.userId }).catch((e: unknown) => setError(errorMessage(e)));
          }}
        >
          {UNDO}
        </BrandButton>
        {error ? (
          <span role="alert" className="aca-err">
            {error}
          </span>
        ) : null}
      </span>
    );
  }
  return <span className="aca-sus">{SUSPENDED_TAG}</span>;
}
