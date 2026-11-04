"use client";

import { useMutation, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useId, useState, type FormEvent } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { LIMIT_FIELDS, LIMIT_LABEL, MAX_COUNT, REQUESTS, shortDate, wholeNumber, type LimitField } from "./text";

type RequestRow = FunctionReturnType<typeof api.lorekeeperLimitRequests.list>["page"][number];

/** Requests shown at first, and per 'Show more'. */
export const REQUESTS_PAGE = 10;

/**
 * Requests (Q21 changed, N10; server AD12): the GMs' waiting limit requests, oldest first. Each row names the campaign
 * and the GM, lists what they ask for next to the campaign's current number, quotes the reason, and offers Approve
 * with editable numbers (prefilled with the asked ones) or Decline. A decided row hides at once (optimistic, rule 12)
 * and comes back with the message if the server refuses.
 */
export function RequestsCard() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.lorekeeperLimitRequests.list,
    { status: "pending" },
    { initialNumItems: REQUESTS_PAGE },
  );
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation(api.lorekeeperLimitRequests.decide);

  function send(requestId: Id<"lorekeeperLimitRequests">, approve: boolean, numbers?: Partial<Record<LimitField, number>>) {
    setError(null);
    setHidden((prev) => new Set(prev).add(requestId));
    decide({ requestId, approve, ...(numbers ? { numbers } : {}) }).catch((e: unknown) => {
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
      setError(errorMessage(e));
    });
  }

  const rows = results.filter((row) => !hidden.has(row._id));
  return (
    <section className="adm-card" aria-labelledby="admk-req-h">
      <div className="adm-card-h">
        <h3 id="admk-req-h">{REQUESTS.title}</h3>
        <p>{REQUESTS.hint}</p>
      </div>
      {status === "LoadingFirstPage" ? (
        <p role="status" className="adm-muted admk-pad">
          Loading …
        </p>
      ) : rows.length === 0 ? (
        <p className="adm-muted admk-pad">{REQUESTS.none}</p>
      ) : (
        <ul className="admk-reqs">
          {rows.map((row) => (
            <RequestItem key={row._id} row={row} onDecide={(approve, numbers) => send(row._id, approve, numbers)} />
          ))}
        </ul>
      )}
      {status === "CanLoadMore" ? (
        <BrandButton variant="neutral" size="sm" className="admk-more" onClick={() => loadMore(REQUESTS_PAGE)}>
          {REQUESTS.more}
        </BrandButton>
      ) : null}
      {error ? (
        <p role="alert" className="admk-err">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function RequestItem({
  row,
  onDecide,
}: {
  row: RequestRow;
  onDecide: (approve: boolean, numbers?: Partial<Record<LimitField, number>>) => void;
}) {
  const asked = LIMIT_FIELDS.filter((field) => row.wants[field] !== undefined);
  // The owner's numbers, starting from the asked ones (local form state, not copied in an effect).
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(asked.map((f) => [f, String(row.wants[f])])));
  const [invalid, setInvalid] = useState(false);
  const headId = useId();
  const campaign = row.campaignName ?? REQUESTS.deletedCampaign;
  const gm = row.requesterName ?? REQUESTS.someGm;

  function approve(event: FormEvent) {
    event.preventDefault();
    const numbers: Partial<Record<LimitField, number>> = {};
    for (const field of asked) {
      const value = wholeNumber(draft[field] ?? "", MAX_COUNT);
      if (value === null) {
        setInvalid(true);
        return;
      }
      numbers[field] = value;
    }
    setInvalid(false);
    onDecide(true, numbers);
  }

  return (
    <li className="admk-req" aria-labelledby={headId}>
      <div className="adm-row-t">
        <b id={headId}>{campaign}</b>
        <span>
          {gm} · asked {shortDate(row.createdAt)}
        </span>
      </div>
      <blockquote className="admk-reason">{row.reason}</blockquote>
      <form className="admk-req-f" onSubmit={approve} aria-label={`Approve ${campaign}`}>
        {asked.map((field) => {
          const current = row.current[field];
          return (
            <label key={field} className="admk-num">
              <span>
                {LIMIT_LABEL[field]}
                <small> · now {current ?? "no limit"}</small>
              </span>
              <input
                className="admk-inp"
                inputMode="numeric"
                value={draft[field] ?? ""}
                aria-invalid={invalid && wholeNumber(draft[field] ?? "", MAX_COUNT) === null}
                onChange={(event) => setDraft((prev) => ({ ...prev, [field]: event.target.value }))}
              />
            </label>
          );
        })}
        <div className="admk-acts">
          <BrandButton type="button" variant="deny" size="sm" onClick={() => onDecide(false)}>
            {REQUESTS.decline}
          </BrandButton>
          <BrandButton type="submit" variant="allow" size="sm">
            {REQUESTS.approve}
          </BrandButton>
        </div>
        {invalid ? (
          <p role="alert" className="admk-err">
            Each number is a whole number from 0 to {MAX_COUNT}.
          </p>
        ) : null}
      </form>
    </li>
  );
}
