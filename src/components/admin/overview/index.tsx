"use client";

import "./overview.css";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { SlotBoundary } from "@/components/party/session/boundary";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { AdminTabProps } from "../slots";
import {
  alertKey,
  alertText,
  CAMPAIGNS_PAGE,
  campaignLine,
  campaignStatus,
  CHANGES_PAGE,
  logActor,
  logText,
  logTime,
  OVERVIEW_TEXT,
  statTiles,
  utcPeriods,
} from "./text";

/**
 * App admin, Overview tab (config AU1; design reference/designs/config/Admin.dc.html `.s-ov`; server AD2
 * convex/adminOverview.ts, AD13 appAdmin.openCampaign; contract ../slots.ts): the four tiles, the alerts, the
 * campaigns card and Recent changes. Each part has its own error boundary (rule 11); the server sends numbers and
 * alert codes, ./text.ts writes the words.
 */
export function OverviewTab({ onTab }: AdminTabProps) {
  return (
    <>
      <SlotBoundary fallback={<Failed what="The numbers" />}>
        <Tiles />
      </SlotBoundary>
      <SlotBoundary fallback={<Failed what="The alerts" />}>
        <Alerts onTab={onTab} />
      </SlotBoundary>
      <SlotBoundary fallback={<Failed what="Campaigns" />}>
        <CampaignsCard />
      </SlotBoundary>
      <SlotBoundary fallback={<Failed what="Recent changes" />}>
        <ChangesCard />
      </SlotBoundary>
    </>
  );
}

function Failed({ what }: { what: string }) {
  return (
    <p role="alert" className="adm-failed">
      {what} failed to load. Reload the page to try again.
    </p>
  );
}

const Loading = () => (
  <p role="status" className="adm-muted admo-pad">
    {OVERVIEW_TEXT.loading}
  </p>
);

// ---------------------------------------------------------------- tiles

function Tiles() {
  const [{ month }] = useState(() => utcPeriods());
  const stats = useQuery(api.adminOverview.stats, { month });
  if (stats === undefined) return <Loading />;
  return (
    <ul className="admo-tiles" aria-label="This month in numbers">
      {statTiles(stats).map((tile) => (
        <li key={tile.label} className="admo-tile">
          <span>{tile.label}</span>
          <b>{tile.value}</b>
          <em>{tile.detail}</em>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- alerts

function Alerts({ onTab }: AdminTabProps) {
  const [{ day, month }] = useState(() => utcPeriods());
  const alerts = useQuery(api.adminOverview.alerts, { day, month });
  if (alerts === undefined || alerts.length === 0) return null;
  return (
    <ul className="admo-alerts" aria-label="Alerts">
      {alerts.map((alert) => {
        const text = alertText(alert);
        return (
          <li key={alertKey(alert)} className="admo-alert">
            <TriangleAlert aria-hidden="true" />
            <div className="adm-row-t">
              <b>{text.title}</b>
              <span>{text.detail}</span>
            </div>
            {text.link ? (
              <BrandButton variant="neutral" size="sm" onClick={() => onTab(text.link!.tab)}>
                {text.link.label}
              </BrandButton>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- campaigns

function CampaignsCard() {
  const titleId = useId();
  const router = useRouter();
  const { results, status, loadMore } = usePaginatedQuery(api.adminOverview.campaigns, {}, { initialNumItems: CAMPAIGNS_PAGE });
  const openCampaign = useMutation(api.appAdmin.openCampaign);
  const [opening, setOpening] = useState<Id<"campaigns"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Logs the visit (AD13: every visit is logged), then opens the campaign; read-only where the owner isn't in it. */
  async function open(campaignId: Id<"campaigns">) {
    setError(null);
    setOpening(campaignId);
    try {
      await openCampaign({ campaignId });
      router.push(`/campaigns/${campaignId}`);
    } catch (e) {
      setError(errorMessage(e));
      setOpening(null);
    }
  }

  return (
    <section className="adm-card" aria-labelledby={titleId}>
      <div className="adm-card-h">
        <h3 id={titleId}>{OVERVIEW_TEXT.campaignsTitle}</h3>
      </div>
      {status === "LoadingFirstPage" ? (
        <Loading />
      ) : results.length === 0 ? (
        <p className="adm-muted admo-pad">{OVERVIEW_TEXT.noCampaigns}</p>
      ) : (
        <ul className="admo-list">
          {results.map((row) => {
            const state = campaignStatus(row);
            const busy = opening === row.campaignId;
            return (
              <li key={row.campaignId} className="adm-row">
                <div className="adm-row-t">
                  <b>{row.name}</b>
                  <span>{campaignLine(row)}</span>
                </div>
                <span className={state.live ? "admo-on" : "admo-on admo-off"}>{state.text}</span>
                <BrandButton
                  variant="neutral"
                  size="sm"
                  aria-label={`${OVERVIEW_TEXT.open} ${row.name}`}
                  disabled={opening !== null}
                  onClick={() => void open(row.campaignId)}
                >
                  {busy ? OVERVIEW_TEXT.opening : OVERVIEW_TEXT.open}
                </BrandButton>
              </li>
            );
          })}
        </ul>
      )}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <div className="admo-more">
          <BrandButton variant="neutral" size="sm" disabled={status === "LoadingMore"} onClick={() => loadMore(CAMPAIGNS_PAGE)}>
            {status === "LoadingMore" ? OVERVIEW_TEXT.loading : OVERVIEW_TEXT.moreCampaigns}
          </BrandButton>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="admo-err">
          {error}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- recent changes

function ChangesCard() {
  const titleId = useId();
  const { results, status, loadMore } = usePaginatedQuery(api.adminOverview.audit, {}, { initialNumItems: CHANGES_PAGE });
  const [now] = useState(Date.now);
  return (
    <section className="adm-card" aria-labelledby={titleId}>
      <div className="adm-card-h">
        <h3 id={titleId}>{OVERVIEW_TEXT.changesTitle}</h3>
        <p>{OVERVIEW_TEXT.changesHint}</p>
      </div>
      {status === "LoadingFirstPage" ? (
        <Loading />
      ) : results.length === 0 ? (
        <p className="adm-muted admo-pad">{OVERVIEW_TEXT.noChanges}</p>
      ) : (
        <ul className="admo-log">
          {results.map((row) => (
            <li key={row._id}>
              <time dateTime={new Date(row.at).toISOString()}>{logTime(row.at, now)}</time>
              <span>
                <b>{logActor(row)}</b> {logText(row)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <div className="admo-more">
          <BrandButton variant="neutral" size="sm" disabled={status === "LoadingMore"} onClick={() => loadMore(CHANGES_PAGE)}>
            {status === "LoadingMore" ? OVERVIEW_TEXT.loading : OVERVIEW_TEXT.moreChanges}
          </BrandButton>
        </div>
      ) : null}
    </section>
  );
}
