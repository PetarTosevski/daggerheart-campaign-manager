"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { ACCENTS } from "@/lib/validation/campaigns";
import { readSettingsBackup, settingsBackupText, type SettingsView } from "@/lib/validation/settings-backup";

import { api } from "../../../convex/_generated/api";

const INPUT =
  "min-h-11 rounded-lg border border-line-2 bg-ink px-3 font-sans text-[15px] text-parchment placeholder:text-faint";

function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h3 id={id} className="m-0 text-[12px] font-medium tracking-[0.22em] text-muted-text uppercase">
      {children}
    </h3>
  );
}

const DATA_BUTTON =
  "min-h-11 cursor-pointer rounded-[10px] border border-line-2 bg-[#1d1a27] px-4 font-sans text-[14px] text-parchment";

type Status = { text: string; ok: boolean };

/**
 * The board's "Saved data" section (D12 H17, option A). Campaigns sync through the account, so the backup is the
 * user's settings only, as copy-and-paste text; nothing goes to browser storage. "Erase all data…" became
 * "Reset settings…", which asks in an in-page alertdialog first.
 */
function SavedData({ settings, onReplaced }: { settings: SettingsView; onReplaced: () => void }) {
  const restore = useMutation(api.settings.restore);
  const reset = useMutation(api.settings.reset);
  const box = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const showBackup = () => {
    flushSync(() => setText(settingsBackupText(settings)));
    box.current?.focus();
    box.current?.select();
    setStatus({ text: "Backup shown below and selected. Copy it (Ctrl/Cmd+C) and keep it somewhere safe.", ok: true });
  };

  const restoreBackup = () => {
    // Checked here first for an instant answer; settings.restore validates the same text again.
    const read = readSettingsBackup(text);
    if (!read.ok) {
      setStatus({ text: read.message, ok: false });
      return;
    }
    setBusy(true);
    restore({ text })
      .then(() => {
        onReplaced();
        setStatus({ text: "Settings restored from the backup.", ok: true });
      })
      .catch((e) => setStatus({ text: errorMessage(e), ok: false }))
      .finally(() => setBusy(false));
  };

  const resetSettings = () => {
    setBusy(true);
    reset({})
      .then(() => {
        setConfirming(false);
        onReplaced();
        setStatus({ text: "Settings reset to their defaults.", ok: true });
      })
      .catch((e) => setStatus({ text: errorMessage(e), ok: false }))
      .finally(() => setBusy(false));
  };

  return (
    <section aria-labelledby="set-data" className="flex flex-col gap-2.5">
      <SectionTitle id="set-data">Saved data</SectionTitle>
      <p className="m-0 text-[14px] leading-normal text-body" data-testid="saved-data-copy">
        Your campaigns are saved to your account and sync across devices. This backup covers your app settings: copy
        it to keep them, or paste one here to restore.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={DATA_BUTTON} onClick={showBackup}>
          Show backup
        </button>
        <button type="button" className={DATA_BUTTON} onClick={restoreBackup} disabled={busy}>
          Restore from pasted backup
        </button>
        <button
          type="button"
          className="ml-auto min-h-11 cursor-pointer rounded-[10px] border border-[#8e2b2b] bg-transparent px-4 font-sans text-[14px] text-[#ff9a92]"
          onClick={() => setConfirming(true)}
        >
          Reset settings…
        </button>
      </div>
      <textarea
        ref={box}
        id="set-backup"
        aria-label="Backup data"
        placeholder="Your backup appears here. To restore, paste a backup and press Restore."
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="min-h-[110px] resize-y rounded-lg border border-line-2 bg-[#0c0b11] px-3 py-2.5 font-mono text-[12px] text-parchment"
      />
      {status ? (
        <div
          role="status"
          data-ok={status.ok}
          className={
            status.ok
              ? "rounded-lg border border-[#2f6a44] bg-[#142a1c] px-3 py-2.5 text-[14px] text-[#d7f2df]"
              : "rounded-lg border border-[#8e2b2b] bg-[#2a1012] px-3 py-2.5 text-[14px] text-[#ffd9d6]"
          }
        >
          {status.text}
        </div>
      ) : null}
      {confirming ? (
        <div
          role="alertdialog"
          aria-label="Confirm reset"
          aria-describedby="set-reset-text"
          className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-[#8e2b2b] bg-[#2a1012] p-3.5"
        >
          <span id="set-reset-text" className="flex-[1_1_240px] text-[14px] text-[#ffd9d6]">
            Put your table name, name, accent colour and expansion defaults back to their defaults? Your campaigns
            are not affected.
          </span>
          <button
            type="button"
            className="min-h-11 cursor-pointer rounded-lg border border-[#5a3a3a] bg-transparent px-3.5 font-sans text-parchment"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="min-h-11 cursor-pointer rounded-lg border-none bg-[#b8322a] px-3.5 font-sans font-semibold text-white"
            onClick={resetSettings}
            disabled={busy}
          >
            Reset
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Settings dialog from the TitleMenu board. Saved to Convex per GM. */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useQuery(api.settings.get);
  const viewer = useQuery(api.users.viewer);
  const update = useMutation(api.settings.update);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const save = (patch: Parameters<typeof update>[0]) => {
    setError(null);
    update(patch).catch((e) => setError(errorMessage(e)));
  };

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      {settings === undefined ? (
        <p className="text-muted-text">Loading…</p>
      ) : (
        <>
          {/* Re-mounted only after a restore or reset (a local counter, not live content), so the uncontrolled name
              fields show the replaced values. */}
          <section key={generation} aria-labelledby="set-table" className="flex flex-col gap-2.5">
            <SectionTitle id="set-table">Table</SectionTitle>
            <label className="flex flex-col gap-1.5 text-[14px]">
              Table name
              <input
                type="text"
                className={INPUT}
                defaultValue={settings.tableName}
                placeholder="e.g. Thursday Night Crew"
                maxLength={80}
                onBlur={(e) => {
                  if (e.target.value.trim() !== settings.tableName) save({ tableName: e.target.value });
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[14px]">
              Your name
              <input
                type="text"
                className={INPUT}
                defaultValue={settings.gmName}
                placeholder="Your name"
                maxLength={80}
                onBlur={(e) => {
                  if (e.target.value.trim() !== settings.gmName) save({ gmName: e.target.value });
                }}
              />
            </label>
          </section>

          <section aria-labelledby="set-display" className="flex flex-col gap-2.5">
            <SectionTitle id="set-display">Display</SectionTitle>
            <span className="text-[14px]">
              Accent colour <span className="text-muted-text">· menu and campaign dashboards</span>
            </span>
            <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2.5">
              {ACCENTS.map((swatch) => {
                const checked = swatch.value === settings.accent;
                return (
                  <button
                    key={swatch.value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={swatch.label}
                    onClick={() => save({ accent: swatch.value })}
                    className="size-11 cursor-pointer rounded-full shadow-[0_0_0_1px_#3a3449]"
                    style={{
                      background: swatch.value,
                      border: `3px solid ${checked ? "#ece6d6" : "transparent"}`,
                    }}
                  />
                );
              })}
            </div>
          </section>

          <section aria-labelledby="set-expansions" className="flex flex-col gap-2.5">
            <SectionTitle id="set-expansions">Expansions</SectionTitle>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
              <input
                type="checkbox"
                role="switch"
                checked={settings.expansions.hopeAndFear ?? false}
                onChange={(e) => save({ expansions: { hopeAndFear: e.target.checked } })}
                className="size-5 flex-none cursor-pointer accent-brand"
              />
              <span>
                Hope &amp; Fear
                <span className="block text-[13px] text-muted-text">
                  New campaigns start with Hope &amp; Fear content. Change it per campaign on its dashboard.
                </span>
                {settings.expansions.hopeAndFear === undefined ? (
                  // Until it is set, each frame keeps its own default (Castle High, for example, starts with Hope & Fear on).
                  <span className="block text-[13px] text-[#c9b27a]" data-testid="expansions-frame-default">
                    Not set yet: each frame uses its own default.
                  </span>
                ) : null}
              </span>
            </label>
            {settings.expansions.hopeAndFear !== undefined ? (
              <button type="button" className="self-start text-[13px] text-muted-text underline underline-offset-2" onClick={() => save({ expansions: { hopeAndFear: null } })}>
                Use each frame&rsquo;s default
              </button>
            ) : null}
          </section>

          <SavedData
            settings={settings}
            onReplaced={() => {
              setError(null);
              setGeneration((g) => g + 1);
            }}
          />

          <section aria-labelledby="set-account" className="flex flex-col gap-2.5">
            <SectionTitle id="set-account">Account</SectionTitle>
            <div className="flex flex-wrap items-center justify-between gap-3 text-[14px] text-body">
              <span>
                Signed in as <span data-testid="viewer-email">{viewer?.email ?? "…"}</span>
              </span>
              <BrandButton
                variant="outline"
                onClick={() => void signOut().then(() => router.push("/signin"))}
              >
                Sign out
              </BrandButton>
            </div>
          </section>

          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-danger-line bg-danger-bg px-3 py-2.5 text-[14px] text-[#ffd9d6]"
            >
              {error}
            </div>
          ) : null}
        </>
      )}
    </Modal>
  );
}
