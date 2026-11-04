"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState, type FormEvent } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { SlotBoundary } from "@/components/party/session/boundary";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { LIMIT_FIELDS, LIMIT_LABEL, MAX_COUNT, meterPercent, usd, USE, wholeNumber, type LimitField } from "./text";

/** The legend's colours, in order (design `.stack` / `.lg`); the rest repeat. */
const COLOURS = ["#e3b45a", "#9fd8c4", "#c9a0f0", "#f0a8a0", "#8fb8f0", "#d8d08a"];

/**
 * Use by campaign (AD6's `useByCampaign`): each campaign's questions and spend this month, most spent first, with the
 * design's stacked bar. 'Limits' opens that campaign's own numbers (AD12's `forCampaign`, which the owner reads
 * through the read-only campaign view, AD13) and sets them one field at a time (`setCampaignLimits`).
 */
export function UseCard({ month }: { month: string }) {
  const use = useQuery(api.adminLorekeeper.useByCampaign, { month });
  const [open, setOpen] = useState<Id<"campaigns"> | null>(null);

  let body;
  if (use === undefined) {
    body = (
      <p role="status" className="adm-muted admk-pad">
        Loading …
      </p>
    );
  } else if (use.campaigns.length === 0) {
    body = <p className="adm-muted admk-pad">{USE.none}</p>;
  } else {
    const total = use.campaigns.reduce((sum, c) => sum + c.questions, 0);
    body = (
      <>
        <div className="admk-stack" aria-hidden="true">
          {use.campaigns.map((c, i) => (
            <span key={c.campaignId} style={{ width: `${meterPercent(c.questions, total)}%`, background: COLOURS[i % COLOURS.length] }} />
          ))}
        </div>
        <ul className="admk-lg">
          {use.campaigns.map((c, i) => {
            const name = c.name ?? USE.deleted;
            const expanded = open === c.campaignId;
            return (
              <li key={c.campaignId}>
                <div className="admk-lg-row">
                  <i style={{ background: COLOURS[i % COLOURS.length] }} />
                  <span className="admk-lg-name">
                    {name}
                    {c.deleted && c.name !== null ? <small> · {USE.deleted}</small> : null}
                  </span>
                  <b>{c.questions}</b>
                  <span className="adm-muted">{usd(c.costMicros)}</span>
                  {c.deleted ? null : (
                    <BrandButton
                      variant="neutral"
                      size="sm"
                      aria-expanded={expanded}
                      aria-label={`${USE.limits}: ${name}`}
                      onClick={() => setOpen(expanded ? null : c.campaignId)}
                    >
                      {USE.limits}
                    </BrandButton>
                  )}
                </div>
                {expanded ? (
                  <SlotBoundary
                    fallback={
                      <p role="alert" className="admk-err">
                        This campaign’s limits failed to load.
                      </p>
                    }
                  >
                    <CampaignLimits campaignId={c.campaignId} name={name} />
                  </SlotBoundary>
                ) : null}
              </li>
            );
          })}
        </ul>
        {use.truncated ? <p className="adm-muted admk-pad">{USE.truncated}</p> : null}
      </>
    );
  }
  return (
    <section className="adm-card" aria-labelledby="admk-use-h">
      <div className="adm-card-h">
        <h3 id="admk-use-h">{USE.title}</h3>
        <p>{USE.hint}</p>
      </div>
      {body}
    </section>
  );
}

/** One campaign's own numbers: a field per number, saved on its own (single-field intent, optimistic). */
export function CampaignLimits({ campaignId, name }: { campaignId: Id<"campaigns">; name: string }) {
  const view = useQuery(api.lorekeeperLimitRequests.forCampaign, { campaignId });
  const settings = useQuery(api.appAdmin.settings, {});
  const [error, setError] = useState<string | null>(null);
  const setLimits = useMutation(api.lorekeeperLimitRequests.setCampaignLimits).withOptimisticUpdate((store, { campaignId: id, change }) => {
    const current = store.getQuery(api.lorekeeperLimitRequests.forCampaign, { campaignId: id });
    const app = store.getQuery(api.appAdmin.settings, {});
    if (!current) return;
    const field = change.field;
    const fallback =
      field === "dailyQuestions" || field === "dailyWebSearches" ? (app?.lorekeeper[field] ?? current.current[field]) : null;
    store.setQuery(api.lorekeeperLimitRequests.forCampaign, { campaignId: id }, {
      ...current,
      current: { ...current.current, [change.field]: change.value ?? fallback, custom: change.value !== null || current.current.custom },
    });
  });

  if (view === undefined || settings === undefined) {
    return (
      <p role="status" className="adm-muted admk-pad">
        Loading …
      </p>
    );
  }
  const save = (field: LimitField, value: number | null) => {
    setError(null);
    setLimits({ campaignId, change: { field, value } }).catch((e: unknown) => setError(errorMessage(e)));
  };
  return (
    <div className="admk-climits" role="group" aria-label={`${USE.limits}: ${name}`}>
      <p className="adm-muted">{USE.limitsHint}</p>
      {LIMIT_FIELDS.map((field) => (
        <LimitInput
          key={field}
          field={field}
          value={view.current[field]}
          appValue={field === "dailyQuestions" || field === "dailyWebSearches" ? settings.lorekeeper[field] : null}
          onSave={(value) => save(field, value)}
        />
      ))}
      {error ? (
        <p role="alert" className="admk-err">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One number of a campaign: the typed draft starts from the saved number (empty = the app's number / no limit). */
function LimitInput({
  field,
  value,
  appValue,
  onSave,
}: {
  field: LimitField;
  value: number | null;
  appValue: number | null;
  onSave: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null || value === appValue ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  const inputId = useId();
  const hintId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    const next = text === "" ? null : wholeNumber(text, MAX_COUNT);
    if (text !== "" && next === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSave(next);
  }

  return (
    <form className="admk-num-row" onSubmit={submit}>
      <label htmlFor={inputId}>{LIMIT_LABEL[field]}</label>
      <input
        id={inputId}
        className="admk-inp"
        inputMode="numeric"
        value={draft}
        placeholder={appValue === null ? "No limit" : String(appValue)}
        aria-describedby={hintId}
        aria-invalid={invalid}
        onChange={(event) => setDraft(event.target.value)}
      />
      <span id={hintId} className="adm-muted">
        {appValue === null ? USE.booksHint : `App: ${appValue}`}
      </span>
      <BrandButton type="submit" variant="neutral" size="sm">
        {USE.save}
      </BrandButton>
    </form>
  );
}
