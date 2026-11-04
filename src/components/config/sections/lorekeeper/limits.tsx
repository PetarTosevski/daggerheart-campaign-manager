"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { SlotBoundary } from "@/components/party/session/boundary";
import { LIMIT_REQUEST_REASON_MAX } from "@/lib/admin/config";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { SettingsSectionProps } from "../../slots";

type View = FunctionReturnType<typeof api.lorekeeperLimitRequests.forCampaign>;
type Field = "dailyQuestions" | "dailyWebSearches" | "bookCount" | "bookPages";
type Numbers = Partial<Record<Field, number>>;

/** The optimistic pending request's stand-in id. */
const OPTIMISTIC_ID = "optimistic" as Id<"lorekeeperLimitRequests">;

const FIELDS: readonly Field[] =["dailyQuestions", "dailyWebSearches", "bookCount", "bookPages"];

/** convex/lorekeeperLimitRequests.ts MAX_WANTED: what a GM may ask for, per number. */
export const MAX_WANTED = 1000;

export const LIMITS_TEXT = {
  title: "Lorekeeper limits",
  label: {
    dailyQuestions: "Questions per day",
    dailyWebSearches: "Internet searches per day",
    bookCount: "Books",
    bookPages: "Book pages",
  } satisfies Record<Field, string>,
  noLimit: "No limit",
  ask: "Ask for higher limits",
  askHint: "The app’s owner approves each request.",
  reason: "Reason",
  reasonHint: (max: number) => `A short reason, up to ${max} characters.`,
  wantHint: "Leave a number empty to keep it as it is.",
  send: "Send request",
  cancel: "Cancel",
  withdraw: "Withdraw",
  pending: (date: string) => `Request sent ${date} · waiting for an answer`,
  approved: (date: string) => `Last request approved ${date}`,
  declined: (date: string) => `Last request declined ${date}`,
  needOne: "Ask for at least one number.",
  needReason: "Give a short reason.",
  badNumber: `Each number is a whole number from 0 to ${MAX_WANTED}.`,
} as const;

/** When an optimistic request was sent (read in the mutation's update, never during render). */
const sentAt = () => Date.now();

const shortDate =(at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** "Questions per day 80 · Internet searches per day 20" (the numbers given). */
function numbersText(numbers: Numbers): string {
  return FIELDS.filter((f) => numbers[f] !== undefined)
    .map((f) => `${LIMITS_TEXT.label[f]} ${numbers[f]}`)
    .join(" · ");
}

/**
 * Ask for higher Lorekeeper limits (config AU3; Q21 changed, N10; server AD12's `lorekeeperLimitRequests`), at the end
 * of Campaign settings > Lorekeeper. While the owner takes requests (`requestsOpen`) it shows this campaign's current
 * numbers, the pending request (with Withdraw) or the 'Ask for higher limits' form (questions per day, internet
 * searches per day, books, book pages and a short reason), and the last answer. Hidden while the owner's switch is
 * off. The owner is never named. Its own error boundary (rule 11).
 */
export function LorekeeperLimits(props: SettingsSectionProps): ReactNode {
  return (
    <SlotBoundary
      fallback={
        <p role="alert" className="cfg-muted">
          Lorekeeper limits failed to load.
        </p>
      }
    >
      <Limits campaignId={props.campaign._id} />
    </SlotBoundary>
  );
}

function Limits({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const view = useQuery(api.lorekeeperLimitRequests.forCampaign, { campaignId });
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation(api.lorekeeperLimitRequests.cancel).withOptimisticUpdate((store) => {
    const current = store.getQuery(api.lorekeeperLimitRequests.forCampaign, { campaignId });
    if (current) store.setQuery(api.lorekeeperLimitRequests.forCampaign, { campaignId }, { ...current, pending: null });
  });

  const request = useMutation(api.lorekeeperLimitRequests.request).withOptimisticUpdate((store, { wants, reason }) => {
    const current = store.getQuery(api.lorekeeperLimitRequests.forCampaign, { campaignId });
    if (!current) return;
    store.setQuery(api.lorekeeperLimitRequests.forCampaign, { campaignId }, {
      ...current,
      // A stand-in until the server answers with the real row (Withdraw uses its id only after that).
      pending: { _id: OPTIMISTIC_ID, wants, reason, status: "pending", createdAt: sentAt(), decidedAt: null, mine: true },
    });
  });

  if (view === undefined || !view.requestsOpen) return null;
  const { current, pending, lastDecision } = view;

  const withdraw = (requestId: Id<"lorekeeperLimitRequests">) => {
    setError(null);
    cancel({ campaignId, requestId }).catch((e: unknown) => setError(errorMessage(e)));
  };
  const send = (wants: Numbers, reason: string) => {
    setError(null);
    setAsking(false);
    request({ campaignId, wants, reason }).catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <section aria-label={LIMITS_TEXT.title} data-testid="settings-lorekeeper-limits">
      <div className="cfg-lbl">{LIMITS_TEXT.title}</div>
      {FIELDS.map((field) => {
        const value = current[field];
        if (value === null && (field === "bookCount" || field === "bookPages")) return null;
        return (
          <div key={field} className="cfg-row">
            <div className="cfg-row-t">
              <b>{LIMITS_TEXT.label[field]}</b>
            </div>
            <span className="tabular-nums">{value ?? LIMITS_TEXT.noLimit}</span>
          </div>
        );
      })}
      {pending ? (
        <div className="cfg-row">
          <div className="cfg-row-t">
            <b>{LIMITS_TEXT.pending(shortDate(pending.createdAt))}</b>
            <span>{numbersText(pending.wants)}</span>
          </div>
          <BrandButton variant="cancel" size="sm" disabled={pending._id === OPTIMISTIC_ID} onClick={() => withdraw(pending._id)}>
            {LIMITS_TEXT.withdraw}
          </BrandButton>
        </div>
      ) : asking ? (
        <AskForm view={view} onSend={send} onClose={() => setAsking(false)} />
      ) : (
        <div className="cfg-row">
          <div className="cfg-row-t">
            <b>{LIMITS_TEXT.ask}</b>
            <span>{LIMITS_TEXT.askHint}</span>
          </div>
          <BrandButton variant="neutral" size="sm" onClick={() => setAsking(true)}>
            {LIMITS_TEXT.ask}
          </BrandButton>
        </div>
      )}
      {lastDecision ? (
        <div className="cfg-row">
          <div className="cfg-row-t">
            <b>
              {(lastDecision.status === "approved" ? LIMITS_TEXT.approved : LIMITS_TEXT.declined)(
                shortDate(lastDecision.decidedAt ?? lastDecision.createdAt),
              )}
            </b>
            <span>{numbersText(lastDecision.wants)}</span>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="cfg-muted text-[#f0a8a0]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function AskForm({ view, onSend, onClose }: { view: View; onSend: (wants: Numbers, reason: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<Field, string>>({ dailyQuestions: "", dailyWebSearches: "", bookCount: "", bookPages: "" });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ids = { reason: useId(), reasonHint: useId(), wantHint: useId() };

  function submit(event: FormEvent) {
    event.preventDefault();
    const wants: Numbers = {};
    for (const field of FIELDS) {
      const text = draft[field].trim();
      if (text === "") continue;
      const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
      if (!Number.isInteger(value) || value > MAX_WANTED) return setError(LIMITS_TEXT.badNumber);
      wants[field] = value;
    }
    if (Object.keys(wants).length === 0) return setError(LIMITS_TEXT.needOne);
    const text = reason.trim();
    if (text === "") return setError(LIMITS_TEXT.needReason);
    setError(null);
    onSend(wants, text);
  }

  return (
    <form className="cfg-row cfg-col flex flex-col gap-3" aria-label={LIMITS_TEXT.ask} onSubmit={submit}>
      <div className="cfg-row-t">
        <b>{LIMITS_TEXT.ask}</b>
        <span id={ids.wantHint}>{LIMITS_TEXT.wantHint}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1 text-[13px]">
            <span>
              {LIMITS_TEXT.label[field]}
              <span className="cfg-muted"> · now {view.current[field] ?? LIMITS_TEXT.noLimit}</span>
            </span>
            <input
              className="min-h-11 rounded-[10px] border border-[#33444a] bg-[#0f171a] px-3 text-[#e6ecea] focus-visible:outline-2 focus-visible:outline-[#e3b45a]"
              inputMode="numeric"
              value={draft[field]}
              aria-describedby={ids.wantHint}
              onChange={(e) => setDraft((prev) => ({ ...prev, [field]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <label htmlFor={ids.reason} className="text-[13px]">
        {LIMITS_TEXT.reason}
      </label>
      <textarea
        id={ids.reason}
        className="min-h-20 rounded-[10px] border border-[#33444a] bg-[#0f171a] p-3 text-[#e6ecea] focus-visible:outline-2 focus-visible:outline-[#e3b45a]"
        value={reason}
        maxLength={LIMIT_REQUEST_REASON_MAX}
        aria-describedby={ids.reasonHint}
        onChange={(e) => setReason(e.target.value)}
      />
      <span id={ids.reasonHint} className="cfg-muted text-[12px]">
        {LIMITS_TEXT.reasonHint(LIMIT_REQUEST_REASON_MAX)}
      </span>
      {error ? (
        <p role="alert" className="cfg-muted text-[#f0a8a0]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <BrandButton type="button" variant="cancel" size="sm" onClick={onClose}>
          {LIMITS_TEXT.cancel}
        </BrandButton>
        <BrandButton type="submit" variant="confirm" size="sm">
          {LIMITS_TEXT.send}
        </BrandButton>
      </div>
    </form>
  );
}
