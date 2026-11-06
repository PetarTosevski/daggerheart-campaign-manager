"use client";

import { useMutation, useQuery } from "convex/react";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import type { CapKey, SignUpMode } from "@/lib/admin/config";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import { CAP_MAX, CAP_MIN, CAP_ROWS, JOIN_TITLE, SIGN_UP_HINT, SIGN_UP_LABEL, SIGN_UP_OPTIONS, steppedCap } from "./text";

/**
 * 'Who can join' (config AU2): the sign-up mode and the four caps (AD3's setSignUpMode / setCap), read from
 * appAdmin.settings. Each click is one single-field intent with an optimistic update of the settings (rule 12), so a
 * run of + clicks counts up at once; a refused write rolls back and its message shows under the card.
 */
export function JoinCard() {
  const settings = useQuery(api.appAdmin.settings, {});
  const [error, setError] = useState<string | null>(null);

  const setMode = useMutation(api.adminAccounts.setSignUpMode).withOptimisticUpdate((store, { mode }) => {
    const current = store.getQuery(api.appAdmin.settings, {});
    if (current) store.setQuery(api.appAdmin.settings, {}, { ...current, signUpMode: mode });
  });
  const setCap = useMutation(api.adminAccounts.setCap).withOptimisticUpdate((store, { cap, value }) => {
    const current = store.getQuery(api.appAdmin.settings, {});
    if (current) store.setQuery(api.appAdmin.settings, {}, { ...current, caps: { ...current.caps, [cap]: value } });
  });

  function run(write: Promise<null>) {
    setError(null);
    write.catch((e: unknown) => setError(errorMessage(e)));
  }

  if (settings === undefined) {
    return (
      <p role="status" className="adm-muted">
        Loading …
      </p>
    );
  }

  const pickMode = (mode: SignUpMode) => {
    if (mode !== settings.signUpMode) run(setMode({ mode }));
  };
  const step = (cap: CapKey, delta: number) => {
    const value = steppedCap(settings.caps[cap], delta);
    if (value !== settings.caps[cap]) run(setCap({ cap, value }));
  };

  return (
    <section className="adm-card" aria-labelledby="adma-join-h">
      <div className="adm-card-h">
        <h3 id="adma-join-h">{JOIN_TITLE}</h3>
      </div>
      <div className="adm-row adma-row-seg">
        <div className="adm-row-t">
          <b>{SIGN_UP_LABEL}</b>
          <span>{SIGN_UP_HINT}</span>
        </div>
        <div className="adma-seg" role="group" aria-label={SIGN_UP_LABEL}>
          {SIGN_UP_OPTIONS.map(({ mode, label }) => (
            <BrandButton
              key={mode}
              variant="neutral"
              size="sm"
              className="adma-seg-b"
              aria-pressed={settings.signUpMode === mode}
              onClick={() => pickMode(mode)}
            >
              {label}
            </BrandButton>
          ))}
        </div>
      </div>
      {CAP_ROWS.map(({ cap, label, hint }) => {
        const value = settings.caps[cap];
        return (
          <div key={cap} className="adm-row">
            <div className="adm-row-t">
              <b>{label}</b>
              {hint ? <span>{hint}</span> : null}
            </div>
            <div className="adma-stp" role="group" aria-label={label}>
              <BrandButton
                variant="tool"
                icon
                aria-label="Fewer"
                disabled={value <= CAP_MIN}
                onClick={() => step(cap, -1)}
              >
                <Minus aria-hidden="true" />
              </BrandButton>
              <b aria-live="polite">{value}</b>
              <BrandButton
                variant="tool"
                icon
                aria-label="More"
                disabled={value >= CAP_MAX}
                onClick={() => step(cap, 1)}
              >
                <Plus aria-hidden="true" />
              </BrandButton>
            </div>
          </div>
        );
      })}
      {error ? (
        <p role="alert" className="adma-err">
          {error}
        </p>
      ) : null}
    </section>
  );
}
