"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

function SectionTitle({ children }: { children: string }) {
  return <h3 className="m-0 text-[12px] font-medium tracking-[0.22em] text-muted-text uppercase">{children}</h3>;
}

const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** GM only: who plays in this campaign, invites by email and the join code. */
export function PlayersDialog({
  campaignId,
  open,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  open: boolean;
  onClose: () => void;
}) {
  const roster = useQuery(api.members.roster, open ? { campaignId } : "skip");
  const access = useQuery(api.members.access, open ? { campaignId } : "skip");
  const rotate = useMutation(api.members.rotateJoinCode);
  const invite = useMutation(api.members.invite);
  const revoke = useMutation(api.members.revokeInvite);
  const removePlayer = useMutation(api.members.removePlayer);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The code is created the first time the GM opens this dialog.
  const hasCode = Boolean(access?.joinCode);
  useEffect(() => {
    if (open && access && !hasCode) void rotate({ campaignId }).catch((e) => setError(errorMessage(e)));
  }, [open, access, hasCode, rotate, campaignId]);

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e) => setError(errorMessage(e)));
  };
  const link = access?.joinCode && typeof window !== "undefined" ? `${window.location.origin}/join/${access.joinCode}` : "";

  return (
    <Modal open={open} onClose={onClose} title="Players">
      <section className="flex flex-col gap-2.5" aria-labelledby="pl-code">
        <SectionTitle>Join code</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <span id="pl-code" className="font-display text-[28px] font-bold tracking-[0.2em] text-brand" data-testid="join-code">
            {access?.joinCode ? formatCode(access.joinCode) : "…"}
          </span>
          <BrandButton
            size="sm"
            disabled={!link}
            onClick={() =>
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
            }
          >
            {copied ? "Link copied" : "Copy join link"}
          </BrandButton>
          <BrandButton size="sm" onClick={() => run(rotate({ campaignId, replace: true }))}>
            New code
          </BrandButton>
        </div>
        <p className="m-0 text-[13px] text-subtle">A new code stops the old one from working. Players who joined stay in.</p>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle>Invite by email</SectionTitle>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const email = String(new FormData(form).get("email") ?? "");
            setError(null);
            invite({ campaignId, email })
              .then(() => form.reset())
              .catch((e) => setError(errorMessage(e)));
          }}
        >
          <input
            name="email"
            type="email"
            required
            aria-label="Player email"
            placeholder="player@example.com"
            className="min-h-11 flex-[1_1_220px] rounded-lg border border-line-2 bg-ink px-3 text-[15px] text-parchment placeholder:text-faint"
          />
          <BrandButton type="submit" variant="solid">
            Invite
          </BrandButton>
        </form>
        <p className="m-0 text-[13px] text-subtle">
          Email invites work for accounts that sign in with Google. Players who use a password should join with the code above.
        </p>
        {access?.invites.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {access.invites.map((i) => (
              <li key={i._id} className="flex items-center justify-between gap-3 text-[14px] text-body">
                <span>
                  {i.email} <span className="text-subtle">· invited</span>
                </span>
                <BrandButton size="sm" aria-label={`Revoke invite for ${i.email}`} onClick={() => run(revoke({ inviteId: i._id }))}>
                  Revoke
                </BrandButton>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle>At the table</SectionTitle>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Players in this campaign">
          <li className="text-[14px] text-body">
            {roster?.gm.name ?? "…"} <span className="text-brand">· Game Master</span>
          </li>
          {roster?.players.map((p) => (
            <li key={p.userId} className="flex items-center justify-between gap-3 text-[14px] text-body">
              <span>
                {p.name} {p.email ? <span className="text-subtle">· {p.email}</span> : null}
              </span>
              <BrandButton
                size="sm"
                variant="danger"
                aria-label={`Remove ${p.name}`}
                onClick={() => run(removePlayer({ campaignId, userId: p.userId }))}
              >
                Remove
              </BrandButton>
            </li>
          ))}
          {roster && roster.players.length === 0 ? <li className="text-[14px] text-subtle">No players yet.</li> : null}
        </ul>
      </section>

      {error ? (
        <p role="alert" className="m-0 rounded-lg border border-danger-line bg-danger-bg px-3 py-2.5 text-[14px] text-[#ffd9d6]">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
