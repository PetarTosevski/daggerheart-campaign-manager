"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { ACCENTS } from "@/lib/validation/campaigns";

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

/** Settings dialog from the TitleMenu board. Saved to Convex per GM. */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useQuery(api.settings.get);
  const viewer = useQuery(api.users.viewer);
  const update = useMutation(api.settings.update);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

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
          <section aria-labelledby="set-table" className="flex flex-col gap-2.5">
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

          <section aria-labelledby="set-account"className="flex flex-col gap-2.5">
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
