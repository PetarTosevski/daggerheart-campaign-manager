"use client";

import "./maintenance.css";

import { useConvexAuth as useAuthTokens } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { ConvexError } from "convex/values";
import { Check, Download, ExternalLink, Lock, X } from "lucide-react";
import { useId, useState, type ComponentType, type FormEvent } from "react";

import { BrandButton, brandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { AdminTabProps } from "../slots";
import { exportSiteUrl, fetchExport, saveBlob } from "./download";

/**
 * App admin, Maintenance tab (config AU5; design reference/designs/config/Admin.dc.html `.s-maint`; server AD10 and
 * AD11, docs/tasks/TASK-CONFIG-AD10.md and TASK-CONFIG-AD11.md). Three cards:
 *
 * - Maintenance mode: the 'Read-only for everyone' switch and the banner message (`adminMaintenance.setReadOnly`,
 *   read back through `appStatus.get`, the banner's own query, with an optimistic update). The message is a draft
 *   until it is saved: on Enter or leaving the field while the mode is on, or with the switch.
 * - Backups: the Convex dashboard link and its note (Q29 a: no "last backup" time), and Export everything: Export ->
 *   'Preparing the file' -> Download (Q30 a). The download sends the owner's token in a header, never in the URL.
 * - Keys and connections: Set / Missing / Connected only (`adminMaintenance.keys` answers booleans).
 */

/** The banner message's maximum length; the server's `READ_ONLY_MESSAGE_MAX` (convex/adminMaintenance.ts, tested equal). */
export const READ_ONLY_MESSAGE_MAX = 200;

export const MAINTENANCE_TEXT = {
  modeTitle: "Maintenance mode",
  readOnly: "Read-only for everyone",
  readOnlyHint: "Everyone can read, but nothing can be changed. A banner says why.",
  message: "Banner message",
  messageHint: `Shown at the top of every page while read-only is on. Up to ${READ_ONLY_MESSAGE_MAX} characters.`,
  messagePlaceholder: "Updating the Combat Map. Back in about 10 minutes.",
  backupsTitle: "Backups",
  dashboard: "Open the Convex dashboard",
  noDashboard: "This deployment isn't on Convex cloud, so there is no dashboard to link to.",
  exportTitle: "Export everything",
  exportHint: "Every campaign, character and note as one JSON file.",
  exportPending: "Preparing the file…",
  exportFailed: "The last export failed. Try again.",
  keysTitle: "Keys and connections",
  keysSource: "From the deployment’s environment variables",
  keysNote: "Keys are never shown or changed here. Change them in the deployment settings.",
} as const;

export const MaintenanceTab: ComponentType<AdminTabProps> = () => (
  <>
    <ModeCard />
    <BackupsCard />
    <KeysCard />
  </>
);

const Loading = () => (
  <p role="status" className="adm-muted">
    Loading …
  </p>
);

// ---------------------------------------------------------------- maintenance mode

type AppStatus = { readOnly: true; message: string | null } | null;

function ModeCard() {
  const status = useQuery(api.appStatus.get, {});
  const titleId = useId();
  return (
    <section className="adm-card" aria-labelledby={titleId}>
      <div className="adm-card-h">
        <h3 id={titleId}>{MAINTENANCE_TEXT.modeTitle}</h3>
      </div>
      {status === undefined ? <Loading /> : <ModeRows status={status} />}
    </section>
  );
}

function ModeRows({ status }: { status: AppStatus }) {
  const on = status !== null;
  const saved = status?.message ?? "";
  // The message being typed; it starts from the saved one (no state copied in effects, rule 13).
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const setReadOnly = useMutation(api.adminMaintenance.setReadOnly).withOptimisticUpdate((store, { on: next, message }) => {
    const text = message?.trim() ?? "";
    store.setQuery(api.appStatus.get, {}, next ? { readOnly: true, message: text === "" ? null : text } : null);
  });

  function send(next: boolean) {
    setError(null);
    setReadOnly({ on: next, message: draft }).catch((e: unknown) => setError(errorMessage(e)));
  }
  /** Saves the message while the mode is on (off, it is only a draft for the next time it is turned on). */
  function saveMessage() {
    if (on && draft.trim() !== saved) send(true);
  }
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    saveMessage();
  }

  return (
    <>
      <div className="adm-row">
        <div className="adm-row-t">
          <b>{MAINTENANCE_TEXT.readOnly}</b>
          <span>{MAINTENANCE_TEXT.readOnlyHint}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={MAINTENANCE_TEXT.readOnly}
          className="adm-sw"
          onClick={() => send(!on)}
        >
          <i />
        </button>
      </div>
      <form className="adm-row adm-col" onSubmit={onSubmit}>
        <div className="adm-row-t">
          <label htmlFor={inputId}>
            <b>{MAINTENANCE_TEXT.message}</b>
          </label>
          <span id={hintId}>{MAINTENANCE_TEXT.messageHint}</span>
        </div>
        <input
          id={inputId}
          className="adm-inp"
          value={draft}
          maxLength={READ_ONLY_MESSAGE_MAX}
          placeholder={MAINTENANCE_TEXT.messagePlaceholder}
          aria-describedby={hintId}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={saveMessage}
        />
      </form>
      {error ? (
        <p role="alert" className="adm-maint-err">
          {error}
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- backups and export

function BackupsCard() {
  const backups = useQuery(api.adminMaintenance.backups, {});
  const titleId = useId();
  return (
    <section className="adm-card" aria-labelledby={titleId}>
      <div className="adm-card-h">
        <h3 id={titleId}>{MAINTENANCE_TEXT.backupsTitle}</h3>
      </div>
      {backups === undefined ? (
        <Loading />
      ) : (
        <div className="adm-row">
          <div className="adm-row-t">
            <b>{backups.note}</b>
            {backups.dashboardUrl === null ? <span>{MAINTENANCE_TEXT.noDashboard}</span> : null}
          </div>
          {backups.dashboardUrl !== null ? (
            <a href={backups.dashboardUrl} target="_blank" rel="noopener noreferrer" className={brandButton({ variant: "neutral", size: "sm" })}>
              <ExternalLink aria-hidden="true" className="size-4" />
              {MAINTENANCE_TEXT.dashboard}
            </a>
          ) : null}
        </div>
      )}
      <ExportRow />
    </section>
  );
}

type ExportStatus = { exportId: Id<"adminExports">; status: "pending" | "ready" | "failed"; createdAt: number; expiresAt: number } | null;

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** The status line under 'Export everything'. */
export function exportLine(status: ExportStatus): string {
  if (status === null) return MAINTENANCE_TEXT.exportHint;
  if (status.status === "pending") return MAINTENANCE_TEXT.exportPending;
  if (status.status === "failed") return MAINTENANCE_TEXT.exportFailed;
  return `Ready. The file is deleted at ${timeOf(status.expiresAt)}.`;
}

/** The download's refusal as text: a gone export says so, every other code reads like any refused call. */
export function downloadError(code: string): string {
  if (code === "NOT_FOUND") return "That export is gone. Export again.";
  return errorMessage(new ConvexError({ code }));
}

/** Export's optimistic update: 'Preparing the file' at once; the server's row (and its id) replaces it. */
function showExportPending(store: OptimisticLocalStore) {
  const current = store.getQuery(api.adminExport.status, {});
  if (current?.status === "pending") return;
  const now = Date.now();
  store.setQuery(api.adminExport.status, {}, { exportId: "pending" as Id<"adminExports">, status: "pending", createdAt: now, expiresAt: now + 60 * 60_000 });
}

function ExportRow() {
  const status = useQuery(api.adminExport.status, {});
  const { fetchAccessToken } = useAuthTokens();
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const start = useMutation(api.adminExport.start).withOptimisticUpdate(showExportPending);

  function onExport() {
    setError(null);
    start({}).catch((e: unknown) => setError(errorMessage(e)));
  }

  async function onDownload(exportId: Id<"adminExports">) {
    setError(null);
    const site = exportSiteUrl();
    if (site === null) return setError(errorMessage(null));
    setDownloading(true);
    try {
      const token = await fetchAccessToken({ forceRefreshToken: false });
      if (!token) return setError(downloadError("UNAUTHENTICATED"));
      const result = await fetchExport(site, exportId, token);
      if (result.ok) saveBlob(result.blob, result.filename);
      else setError(downloadError(result.code));
    } catch {
      setError(errorMessage(null));
    } finally {
      setDownloading(false);
    }
  }

  if (status === undefined) return <Loading />;
  const pending = status?.status === "pending";
  const ready = status?.status === "ready" ? status : null;
  return (
    <>
      <div className="adm-row">
        <div className="adm-row-t">
          <b>{MAINTENANCE_TEXT.exportTitle}</b>
          <span role="status" data-testid="export-status">
            {exportLine(status)}
          </span>
        </div>
        <div className="adm-maint-acts">
          {ready ? (
            <BrandButton variant="confirm" size="sm" disabled={downloading} onClick={() => void onDownload(ready.exportId)}>
              <Download aria-hidden="true" className="size-4" />
              {downloading ? "Downloading…" : "Download"}
            </BrandButton>
          ) : null}
          <BrandButton variant="neutral" size="sm" disabled={pending} onClick={onExport}>
            <Download aria-hidden="true" className="size-4" />
            {pending ? "Exporting…" : ready ? "Export again" : "Export"}
          </BrandButton>
        </div>
      </div>
      {error ? (
        <p role="alert" className="adm-maint-err">
          {error}
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- keys and connections

type Keys = { database: boolean; anthropicKey: boolean; resendKey: boolean; mailFrom: boolean; siteUrl: boolean; google: boolean };

/** The rows of Keys and connections: a label and whether it is there (`connection`: the database says Connected). */
export function keyRows(keys: Keys): { label: string; ok: boolean; connection?: boolean }[] {
  return [
    { label: "Database", ok: keys.database, connection: true },
    { label: "Anthropic API key", ok: keys.anthropicKey },
    { label: "Email", ok: keys.resendKey && keys.mailFrom },
    { label: "Site URL", ok: keys.siteUrl },
    { label: "Google sign-in", ok: keys.google },
  ];
}

function KeysCard() {
  const keys = useQuery(api.adminMaintenance.keys, {});
  const titleId = useId();
  return (
    <section className="adm-card" aria-labelledby={titleId}>
      <div className="adm-card-h">
        <h3 id={titleId}>{MAINTENANCE_TEXT.keysTitle}</h3>
      </div>
      {keys === undefined ? (
        <Loading />
      ) : (
        keyRows(keys).map(({ label, ok, connection }) => (
          <div key={label} className="adm-row">
            <div className="adm-row-t">
              <b>{label}</b>
              <span>{MAINTENANCE_TEXT.keysSource}</span>
            </div>
            <span className={ok ? "adm-maint-on" : "adm-maint-on adm-maint-off"}>
              {ok ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
              {ok ? (connection ? "Connected" : "Set") : "Missing"}
            </span>
          </div>
        ))
      )}
      <p className="adm-maint-note">
        <Lock aria-hidden="true" />
        {MAINTENANCE_TEXT.keysNote}
      </p>
    </section>
  );
}
