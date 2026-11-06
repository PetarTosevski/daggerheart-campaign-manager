"use client";

import "./players.css";

import { useMutation, useQuery } from "convex/react";
import { Link2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { joinUrl } from "./lib";

/** `copy(text)` writes to the clipboard; `copied` is true for 2 s after. */
export function useCopied(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clears the pending reset on unmount (no state copy, no mutation).
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return {
    copied,
    copy: (text: string) =>
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      }),
  };
}

const small = (role: "neutral" | "danger" | "tool") => glassButtonClass({ role, size: "sm", wrap: true });

/**
 * The 'Invite a player' card (design `.invite`): the join link with Copy link (clipboard + 'Copied' status) and New link
 * (`members.rotateJoinCode`). With no code yet it offers 'Make a link' (a click, not an effect: rule 13).
 */
export function JoinLinkCard({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const access = useQuery(api.members.access, { campaignId });
  const rotate = useMutation(api.members.rotateJoinCode);
  const { copied, copy } = useCopied();
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const code = access?.joinCode ?? null;
  const link = code && typeof window !== "undefined" ? joinUrl(window.location.origin, code) : "";

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <section className="cfg-pl-invite" aria-labelledby={titleId}>
      <div className="cfg-row-t">
        <b id={titleId}>Invite a player</b>
        <span>Anyone with the link can join this campaign as a player.</span>
      </div>
      {access === undefined ? (
        <p role="status" className="cfg-muted">
          Loading …
        </p>
      ) : code ? (
        <div className="cfg-pl-inv">
          <code data-testid="settings-join-link">{link}</code>
          <button type="button" className={small("neutral")} onClick={() => run(copy(link))}>
            <Link2 size={16} aria-hidden="true" />
            Copy link
          </button>
          <button type="button" className={small("tool")} onClick={() => run(rotate({ campaignId, replace: true }))}>
            New link
          </button>
        </div>
      ) : (
        <div className="cfg-pl-inv">
          <button type="button" className={small("neutral")} onClick={() => run(rotate({ campaignId }))}>
            Make a link
          </button>
        </div>
      )}
      <span role="status" className="cfg-pl-copied">
        {copied ? "Copied" : ""}
      </span>
      {code ? <p className="cfg-muted">A new link stops the old one from working. Players who joined stay in.</p> : null}
      {error ? (
        <p role="alert" className="cfg-pl-err">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Invite by email (moved here from the Players dialog, which imports it): the address, for the creator 'Invite as'
 * Player / Co-GM (Q8 b), Invite (`members.invite`), then the pending invites with Revoke (`members.revokeInvite`), a
 * co-GM invite marked 'Co-GM'. `canInviteCoGm` is the campaign's `isCreator` (display only; the server checks).
 */
export function EmailInvites({ campaignId, canInviteCoGm = false }: { campaignId: Id<"campaigns">; canInviteCoGm?: boolean }) {
  const access = useQuery(api.members.access, { campaignId });
  const invite = useMutation(api.members.invite);
  const revoke = useMutation(api.members.revokeInvite);
  const [asCoGm, setAsCoGm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="cfg-pl-email">
      <form
        className="cfg-pl-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const email = String(new FormData(form).get("email") ?? "");
          setError(null);
          invite({ campaignId, email, ...(canInviteCoGm && asCoGm ? { asCoGm: true } : {}) })
            .then(() => form.reset())
            .catch((e: unknown) => setError(errorMessage(e)));
        }}
      >
        <input
          name="email"
          type="email"
          required
          aria-label="Player email"
          placeholder="player@example.com"
          className="cfg-pl-input min-h-11 flex-[1_1_220px] rounded-lg border border-line-2 bg-ink px-3 text-[15px] text-parchment placeholder:text-faint"
        />
        {canInviteCoGm ? (
          <div className="cfg-seg cfg-pl-as" role="group" aria-label="Invite as">
            <button type="button" className={glassButtonClass({ role: "neutral", size: "sm" })} aria-pressed={!asCoGm} onClick={() => setAsCoGm(false)}>
              Player
            </button>
            <button type="button" className={glassButtonClass({ role: "neutral", size: "sm" })} aria-pressed={asCoGm} onClick={() => setAsCoGm(true)}>
              Co-GM
            </button>
          </div>
        ) : null}
        <button type="submit" className={glassButtonClass({ role: "neutral", wrap: true })}>
          Invite
        </button>
      </form>
      <p className="m-0 text-[13px] text-subtle">
        The player gets an email with a sign-in link. The campaign appears once they sign in or sign up with that address, with Google or a verified password account.
      </p>
      {access?.invites.length ? (
        <ul className="cfg-pl-pending" aria-label="Pending invites">
          {access.invites.map((i) => (
            <li key={i._id}>
              <span>
                {i.email} <span className="text-subtle">· invited</span>
                {i.asCoGm ? <span className="cfg-pl-role cfg-pl-role-co">Co-GM</span> : null}
              </span>
              <button
                type="button"
                className={small("danger")}
                aria-label={`Revoke invite for ${i.email}`}
                onClick={() => {
                  setError(null);
                  revoke({ inviteId: i._id }).catch((e: unknown) => setError(errorMessage(e)));
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="cfg-pl-err">
          {error}
        </p>
      ) : null}
    </div>
  );
}
