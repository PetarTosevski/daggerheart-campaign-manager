"use client";

import "./lorekeeper.css";

import { useState, type ComponentType } from "react";

import { SlotBoundary } from "@/components/party/session/boundary";

import type { AdminTabProps } from "../slots";
import { LibraryCard } from "./library-card";
import { RequestsCard } from "./requests-card";
import { BudgetCard, PerPersonCard } from "./settings-cards";
import { utcMonth } from "./text";
import { UseCard } from "./use-card";

function Failed({ what }: { what: string }) {
  return (
    <p role="alert" className="adm-failed">
      {what} failed to load. Reload the page to try again.
    </p>
  );
}

/**
 * App admin, Lorekeeper tab (config AU3; design reference/designs/config/Admin.dc.html `.s-lore`; contract ../slots.ts;
 * servers AD6, AD7, AD8, AD12): Budget, Limits per person, Requests (Q21 changed, N10), Use by campaign (with each
 * campaign's own numbers) and the Book library. Each card has its own error boundary (rule 11). The month is the
 * current UTC month when the tab opens (the counters' month).
 */
export const LorekeeperTab: ComponentType<AdminTabProps> = () => {
  const [month] = useState(() => utcMonth(Date.now()));
  return (
    <>
      <SlotBoundary fallback={<Failed what="Budget" />}>
        <BudgetCard month={month} />
      </SlotBoundary>
      <SlotBoundary fallback={<Failed what="Limits per person" />}>
        <PerPersonCard />
      </SlotBoundary>
      <SlotBoundary fallback={<Failed what="Requests" />}>
        <RequestsCard />
      </SlotBoundary>
      <SlotBoundary fallback={<Failed what="Use by campaign" />}>
        <UseCard month={month} />
      </SlotBoundary>
      <SlotBoundary fallback={<Failed what="Book library" />}>
        <LibraryCard />
      </SlotBoundary>
    </>
  );
};
