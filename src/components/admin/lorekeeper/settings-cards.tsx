"use client";

import { useMutation, useQuery } from "convex/react";
import { Minus, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import {
  AT_LIMIT_OPTIONS,
  BUDGET,
  dollars,
  MAX_COUNT,
  MAX_USD,
  meterPercent,
  PER_PERSON,
  stepped,
  usd,
  USD_STEP,
} from "./text";

type LorekeeperChange =
  | { field: "monthlyUsd" | "dailyQuestions" | "dailyWebSearches"; value: number }
  | { field: "atLimit"; value: "pause" | "gmOnly" | "short" }
  | { field: "allowGmRequests" | "emailAt80"; value: boolean };

/**
 * The owner's Lorekeeper settings (AD6's `adminLorekeeper.setLimit`, read back through `appAdmin.settings`). Each
 * click is one single-field intent with an optimistic update (rule 12), so a run of + clicks counts up at once; a
 * refused write rolls back and its message shows under the card.
 */
function useSetLimit() {
  const [error, setError] = useState<string | null>(null);
  const setLimit = useMutation(api.adminLorekeeper.setLimit).withOptimisticUpdate((store, { change }) => {
    const current = store.getQuery(api.appAdmin.settings, {});
    if (current) store.setQuery(api.appAdmin.settings, {}, { ...current, lorekeeper: { ...current.lorekeeper, [change.field]: change.value } });
  });
  const set = (change: LorekeeperChange) => {
    setError(null);
    setLimit({ change }).catch((e: unknown) => setError(errorMessage(e)));
  };
  return { set, error };
}

const Loading = () => (
  <p role="status" className="adm-muted">
    Loading …
  </p>
);

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="admk-err">
      {error}
    </p>
  ) : null;
}

function RowText({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="adm-row-t">
      <b>{label}</b>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

/** The design's `.stp`: − value +, as a labelled group. */
export function Stepper({
  label,
  value,
  text,
  onStep,
  max,
}: {
  label: string;
  value: number;
  text?: string;
  onStep: (delta: -1 | 1) => void;
  max: number;
}) {
  return (
    <div className="admk-stp" role="group" aria-label={label}>
      <BrandButton variant="tool" icon aria-label="Fewer" disabled={value <= 0} onClick={() => onStep(-1)}>
        <Minus aria-hidden="true" />
      </BrandButton>
      <b aria-live="polite">{text ?? value}</b>
      <BrandButton variant="tool" icon aria-label="More" disabled={value >= max} onClick={() => onStep(1)}>
        <Plus aria-hidden="true" />
      </BrandButton>
    </div>
  );
}

/** The design's `.sw`: a button with role switch. */
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="admk-sw" onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

function Meter({ label, value, max, valueText, children }: { label: string; value: number; max: number; valueText: string; children: ReactNode }) {
  return (
    <div className="admk-mt">
      <div className="admk-mt-t">
        <span>{label}</span>
        <b>{children}</b>
      </div>
      <div
        className="admk-mt-b"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
      >
        <span style={{ width: `${meterPercent(value, max)}%` }} />
      </div>
    </div>
  );
}

/**
 * Budget (design `.s-lore` first card): the month's spend against the limit (meter), the month's questions (count only,
 * Q22 a: there is no monthly question cap), the monthly limit stepper, what happens at the limit (Q20 a) and the 80%
 * email switch (AD7, default on).
 */
export function BudgetCard({ month }: { month: string }) {
  const settings = useQuery(api.appAdmin.settings, {});
  const use = useQuery(api.adminLorekeeper.useByCampaign, { month });
  const { set, error } = useSetLimit();

  let body: ReactNode = <Loading />;
  if (settings !== undefined && use !== undefined) {
    const lk = settings.lorekeeper;
    const limitMicros = Math.round(lk.monthlyUsd * 1_000_000);
    const spent = use.total.costMicros;
    body = (
      <>
        <Meter label={BUDGET.spend} value={spent / 1_000_000} max={lk.monthlyUsd} valueText={`${usd(spent)} of ${usd(limitMicros)}`}>
          {usd(spent)} <i>of {usd(limitMicros)}</i>
        </Meter>
        <div className="admk-mt">
          <div className="admk-mt-t">
            <span>{BUDGET.questions}</span>
            <b>{use.total.questions}</b>
          </div>
        </div>
        <div className="adm-row">
          <RowText label={BUDGET.limit} hint={BUDGET.limitHint} />
          <Stepper
            label={BUDGET.limit}
            value={lk.monthlyUsd}
            text={dollars(lk.monthlyUsd)}
            max={MAX_USD}
            onStep={(delta) => {
              const value = stepped(lk.monthlyUsd, delta * USD_STEP, MAX_USD);
              if (value !== lk.monthlyUsd) set({ field: "monthlyUsd", value });
            }}
          />
        </div>
        <div className="adm-row admk-col">
          <RowText label={BUDGET.atLimit} />
          <div className="admk-seg" role="group" aria-label={BUDGET.atLimit}>
            {AT_LIMIT_OPTIONS.map(({ mode, label }) => (
              <BrandButton
                key={mode}
                variant="neutral"
                size="sm"
                className="admk-seg-b"
                aria-pressed={lk.atLimit === mode}
                onClick={() => {
                  if (lk.atLimit !== mode) set({ field: "atLimit", value: mode });
                }}
              >
                {label}
              </BrandButton>
            ))}
          </div>
        </div>
        <div className="adm-row">
          <RowText label={BUDGET.email} />
          <Switch label={BUDGET.email} checked={lk.emailAt80} onChange={(value) => set({ field: "emailAt80", value })} />
        </div>
        <ErrorLine error={error} />
      </>
    );
  }
  return (
    <section className="adm-card" aria-labelledby="admk-budget-h">
      <div className="adm-card-h">
        <h3 id="admk-budget-h">{BUDGET.title}</h3>
      </div>
      {body}
    </section>
  );
}

/** Limits per person: questions and internet searches per day, and the GMs' request switch (N10). */
export function PerPersonCard() {
  const settings = useQuery(api.appAdmin.settings, {});
  const { set, error } = useSetLimit();

  let body: ReactNode = <Loading />;
  if (settings !== undefined) {
    const lk = settings.lorekeeper;
    const step = (field: "dailyQuestions" | "dailyWebSearches", delta: number) => {
      const value = stepped(lk[field], delta, MAX_COUNT);
      if (value !== lk[field]) set({ field, value });
    };
    body = (
      <>
        <div className="adm-row">
          <RowText label={PER_PERSON.questions} hint={PER_PERSON.questionsHint} />
          <Stepper label={PER_PERSON.questions} value={lk.dailyQuestions} max={MAX_COUNT} onStep={(d) => step("dailyQuestions", d)} />
        </div>
        <div className="adm-row">
          <RowText label={PER_PERSON.searches} hint={PER_PERSON.searchesHint} />
          <Stepper label={PER_PERSON.searches} value={lk.dailyWebSearches} max={MAX_COUNT} onStep={(d) => step("dailyWebSearches", d)} />
        </div>
        <div className="adm-row">
          <RowText label={PER_PERSON.requests} hint={PER_PERSON.requestsHint} />
          <Switch label={PER_PERSON.requests} checked={lk.allowGmRequests} onChange={(value) => set({ field: "allowGmRequests", value })} />
        </div>
        <ErrorLine error={error} />
      </>
    );
  }
  return (
    <section className="adm-card" aria-labelledby="admk-person-h">
      <div className="adm-card-h">
        <h3 id="admk-person-h">{PER_PERSON.title}</h3>
      </div>
      {body}
    </section>
  );
}
