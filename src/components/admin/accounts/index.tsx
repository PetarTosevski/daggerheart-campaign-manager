"use client";

import "./accounts.css";

import { SlotBoundary } from "@/components/party/session/boundary";

import type { AdminTabProps } from "../slots";
import { AccountTable } from "./account-table";
import { JoinCard } from "./join-card";

function Failed({ what }: { what: string }) {
  return (
    <p role="alert" className="adm-failed">
      {what} failed to load. Reload the page to try again.
    </p>
  );
}

/**
 * App admin, Accounts tab (config AU2; design reference/designs/config/Admin.dc.html `.s-acc`; contract ../slots.ts):
 * 'Who can join' (sign-up mode and the four caps) and the account table. No 'Who can create a campaign' and no
 * 'Waiting for you' (user decision). Each card has its own error boundary (rule 11).
 */
export function AccountsTab(props: AdminTabProps) {
  void props;
  return (
    <>
      <SlotBoundary fallback={<Failed what="Who can join" />}>
        <JoinCard />
      </SlotBoundary>
      <SlotBoundary fallback={<Failed what="Accounts" />}>
        <AccountTable />
      </SlotBoundary>
    </>
  );
}
