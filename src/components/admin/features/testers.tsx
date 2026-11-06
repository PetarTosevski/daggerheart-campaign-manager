"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { optimisticallyUpdateValueInPaginatedQuery, useMutation, usePaginatedQuery } from "convex/react";
import { useState, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { accountName, FEATURES_TEXT, joinNames } from "./text";

/** One page of the account table (AD3 clamps it to 50). */
export const ACCOUNTS_PAGE = 50;

/** Marks one account as a tester (or not) in every loaded page of `adminAccounts.accounts` (rule 12). */
export function setTesterLocally(store: OptimisticLocalStore, userId: Id<"users">, tester: boolean): void {
  optimisticallyUpdateValueInPaginatedQuery(store, api.adminAccounts.accounts, {}, (row) => (row.userId === userId ? { ...row, tester } : row));
}

/**
 * The Testers card (config AU4; design `.s-flags` second card). AD9 has no tester list of its own, so the card reads
 * AD3's account table (`adminAccounts.accounts`, newest first, a page at a time) and shows the loaded accounts that
 * are testers; Edit opens a picker over the same table that adds or removes one account per click
 * (`adminAccounts.addTester` / `removeTester`, optimistic). The owner is not listed: the owner sees Testers features.
 */
export function TestersCard(): ReactNode {
  const { results, status, loadMore } = usePaginatedQuery(api.adminAccounts.accounts, {}, { initialNumItems: ACCOUNTS_PAGE });
  const addTester = useMutation(api.adminAccounts.addTester).withOptimisticUpdate((store, { userId }) => setTesterLocally(store, userId, true));
  const removeTester = useMutation(api.adminAccounts.removeTester).withOptimisticUpdate((store, { userId }) => setTesterLocally(store, userId, false));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accounts = results.filter((a) => a.role !== "owner");
  const testers = accounts.filter((a) => a.tester);
  const loading = status === "LoadingFirstPage";

  async function toggle(userId: Id<"users">, tester: boolean) {
    setError(null);
    try {
      await (tester ? removeTester({ userId }) : addTester({ userId }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section className="adm-card" aria-labelledby="afs-testers">
      <div className="adm-card-h">
        <h3 id="afs-testers">{FEATURES_TEXT.testersTitle}</h3>
      </div>
      {loading ? (
        <p role="status" className="adm-muted afs-pad">
          {FEATURES_TEXT.loading}
        </p>
      ) : (
        <div className="adm-row" data-testid="testers-row">
          {testers.length > 0 ? (
            <span className="afs-tst" aria-hidden="true">
              {testers.slice(0, 4).map((t) => (
                <span key={t.userId} className="afs-pf">
                  {accountName(t).charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
          ) : null}
          <div className="adm-row-t">
            <b>{testers.length > 0 ? joinNames(testers.map(accountName)) : FEATURES_TEXT.noTesters}</b>
            <span>{FEATURES_TEXT.testersHint}</span>
            {status === "CanLoadMore" ? <span>{FEATURES_TEXT.olderNotLoaded}</span> : null}
          </div>
          <BrandButton variant="neutral" size="sm" onClick={() => setOpen(true)}>
            {FEATURES_TEXT.edit}
          </BrandButton>
        </div>
      )}
      <p aria-live="polite" className="adm-muted afs-err">
        {open ? null : error}
      </p>
      <Modal open={open} onClose={() => setOpen(false)} title={FEATURES_TEXT.pickerTitle}>
        <p className="adm-muted">{FEATURES_TEXT.pickerIntro}</p>
        {accounts.length === 0 && status !== "CanLoadMore" ? <p className="adm-muted">{FEATURES_TEXT.noAccounts}</p> : null}
        <ul className="afs-pick" aria-label="Accounts">
          {accounts.map((a) => {
            const name = accountName(a);
            return (
              <li key={a.userId} className="afs-pick-row">
                <div className="adm-row-t">
                  <b>{name}</b>
                  {a.email && a.email !== name ? <span>{a.email}</span> : null}
                </div>
                <BrandButton
                  variant={a.tester ? "cancel" : "neutral"}
                  size="sm"
                  aria-label={a.tester ? `Remove ${name} from testers` : `Add ${name} to testers`}
                  onClick={() => void toggle(a.userId, a.tester)}
                >
                  {a.tester ? "Remove" : "Add"}
                </BrandButton>
              </li>
            );
          })}
        </ul>
        {status === "CanLoadMore" || status === "LoadingMore" ? (
          <BrandButton variant="neutral" size="sm" disabled={status === "LoadingMore"} onClick={() => loadMore(ACCOUNTS_PAGE)}>
            {FEATURES_TEXT.more}
          </BrandButton>
        ) : null}
        <p aria-live="polite" className="adm-muted afs-err">
          {open ? error : null}
        </p>
      </Modal>
    </section>
  );
}
