"use client";

import { optimisticallyUpdateValueInPaginatedQuery, useMutation, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Ellipsis } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AccountActions, AccountStatusMark } from "./account-actions";
import {
  accountInitial,
  accountName,
  ACCOUNTS_PAGE,
  ACCOUNTS_TITLE,
  ADD_TESTER,
  campaignList,
  lastSeenText,
  REMOVE_TESTER,
  ROLE_LABEL,
} from "./text";

/** One row of adminAccounts.accounts (AD3). */
export type AccountRow = FunctionReturnType<typeof api.adminAccounts.accounts>["page"][number];

/** The clock 'Last seen' counts from, refreshed each minute. */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

type SetTester = (args: { userId: Id<"users"> }) => Promise<null>;

/**
 * The row's '···' menu: Add to testers / Remove from testers, then AU9's account-actions slot. A disclosure button
 * with a `role="menu"` list; Escape or a click outside closes it and focus returns to the button.
 */
function RowMenu({
  account,
  addTester,
  removeTester,
  onError,
}: {
  account: AccountRow;
  addTester: SetTester;
  removeTester: SetTester;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const name = accountName(account);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  function toggleTester() {
    const write = account.tester ? removeTester : addTester;
    onError(null);
    write({ userId: account.userId }).catch((e: unknown) => onError(errorMessage(e)));
    close();
  }

  return (
    <div className="adma-menu-wrap" ref={wrap} onKeyDown={onKeyDown}>
      <BrandButton
        ref={trigger}
        variant="tool"
        size="sm"
        aria-label={`Options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <Ellipsis aria-hidden="true" />
      </BrandButton>
      {open ? (
        <div id={menuId} role="menu" aria-label={`Options for ${name}`} className="adma-menu">
          <BrandButton role="menuitem" variant="neutral" size="sm" className="w-full" onClick={toggleTester}>
            {account.tester ? REMOVE_TESTER : ADD_TESTER}
          </BrandButton>
          <AccountActions account={account} onDone={close} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The account table (config AU2): Account / Role / Campaigns / Last seen / Actions, newest accounts first, paged by
 * adminAccounts.accounts (AD3). Testers toggles are intents with an optimistic update of the loaded pages (rule 12).
 */
export function AccountTable() {
  const { results, status, loadMore } = usePaginatedQuery(api.adminAccounts.accounts, {}, { initialNumItems: ACCOUNTS_PAGE });
  const now = useMinuteClock();
  const [error, setError] = useState<string | null>(null);

  const markTester = (tester: boolean) => (store: Parameters<typeof optimisticallyUpdateValueInPaginatedQuery>[0], { userId }: { userId: Id<"users"> }) =>
    optimisticallyUpdateValueInPaginatedQuery(store, api.adminAccounts.accounts, {}, (row) =>
      row.userId === userId ? { ...row, tester } : row,
    );
  const addTester = useMutation(api.adminAccounts.addTester).withOptimisticUpdate(markTester(true));
  const removeTester = useMutation(api.adminAccounts.removeTester).withOptimisticUpdate(markTester(false));

  return (
    <section className="adm-card" aria-labelledby="adma-acc-h">
      <div className="adm-card-h">
        <h3 id="adma-acc-h">{ACCOUNTS_TITLE}</h3>
      </div>
      {status === "LoadingFirstPage" ? (
        <p role="status" className="adm-muted adma-pad">
          Loading …
        </p>
      ) : (
        <>
          <table className="adma-tb">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Role</th>
                <th scope="col">Campaigns</th>
                <th scope="col">Last seen</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((account) => (
                <tr key={account.userId}>
                  <td>
                    <span className="adma-who">
                      <span className="adma-ini" aria-hidden="true">
                        {accountInitial(account)}
                      </span>
                      <span className="adma-who-t">
                        <b>{accountName(account)}</b>
                        {account.tester ? <span className="adma-tag">Tester</span> : null}
                        <AccountStatusMark account={account} now={now} />
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className={`adma-rl adma-rl-${account.role}`}>{ROLE_LABEL[account.role]}</span>
                  </td>
                  <td>{campaignList(account.campaigns, account.moreCampaigns)}</td>
                  <td className="adma-dim">{lastSeenText(account.lastSeen, now)}</td>
                  <td className="adma-ar">
                    {account.role === "owner" ? null : (
                      <RowMenu account={account} addTester={addTester} removeTester={removeTester} onError={setError} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {results.length === 0 && status === "Exhausted" ? <p className="adm-muted adma-pad">No accounts yet.</p> : null}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <div className="adma-more">
          <BrandButton variant="neutral" size="sm" disabled={status === "LoadingMore"} onClick={() => loadMore(ACCOUNTS_PAGE)}>
            {status === "LoadingMore" ? "Loading …" : "Show more accounts"}
          </BrandButton>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="adma-err">
          {error}
        </p>
      ) : null}
    </section>
  );
}
