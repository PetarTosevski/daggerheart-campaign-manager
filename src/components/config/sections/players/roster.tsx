"use client";

import "./players.css";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";
import { portraitSource } from "@/components/party/portrait-source";
import { errorMessage } from "@/lib/convex-errors";
import { designAsset } from "@/lib/design-assets";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../../../convex/lib/validators/characters";
import { playsLine, rowActions } from "./lib";
import { PresenceSlot } from "./presence";

type Member = { userId: Id<"users">; name: string; coGm: boolean };

/** Patches the live roster in place (rule 12): `edit` returns the new rows. */
function patchRoster(store: OptimisticLocalStore, campaignId: Id<"campaigns">, edit: (rows: Member[]) => Member[]) {
  const roster = store.getQuery(api.members.roster, { campaignId });
  if (!roster) return;
  if (roster.viewer === "gm") store.setQuery(api.members.roster, { campaignId }, { ...roster, players: edit(roster.players) as typeof roster.players });
  else store.setQuery(api.members.roster, { campaignId }, { ...roster, players: edit(roster.players) as typeof roster.players });
}

/** The member's face (design `.pl .pf`): their first character's portrait, else the initial of their name. */
function Face({ name, character }: { name: string; character: CharacterView | undefined }) {
  const source = character ? portraitSource(character.sheet) : null;
  const src = source?.kind === "upload" ? character?.portraitUrl : source?.kind === "asset" ? designAsset(source.asset) : null;
  return (
    <span className="cfg-face cfg-face-pc cfg-pl-face">
      {src && source ? (
        <Image
          src={src}
          alt=""
          fill
          sizes="38px"
          unoptimized={source.kind === "upload"}
          style={{ objectFit: "cover", objectPosition: source.kind === "asset" ? source.position : "center 30%" }}
        />
      ) : (
        <span aria-hidden="true">{(name || "?").charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

/** The '···' menu of one row: Make co-GM / Remove co-GM (creator), Remove from campaign (a confirm step, glass danger). */
function RowMenu({
  member,
  campaignId,
  viewerIsCreator,
  onError,
}: {
  member: Member;
  campaignId: Id<"campaigns">;
  viewerIsCreator: boolean;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const actions = rowActions(viewerIsCreator, member);
  const setCoGm = useMutation(api.members.setCoGm).withOptimisticUpdate((store, args) =>
    patchRoster(store, args.campaignId, (rows) => rows.map((r) => (r.userId === args.userId ? { ...r, coGm: args.coGm } : r))),
  );
  const remove = useMutation(api.members.removePlayer).withOptimisticUpdate((store, args) =>
    patchRoster(store, args.campaignId, (rows) => rows.filter((r) => r.userId !== args.userId)),
  );

  // Closes the menu on a click outside it (a DOM listener while open; no state is copied, no mutation runs).
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!actions.toggleCoGm && !actions.remove) return null;
  const run = (p: Promise<unknown>) => {
    onError(null);
    p.catch((e: unknown) => onError(errorMessage(e)));
  };

  if (confirming) {
    return (
      <div className="cfg-pl-confirm" role="group" aria-label={`Remove ${member.name}?`}>
        <span>Remove {member.name}?</span>
        <button
          type="button"
          className={glassButtonClass({ role: "danger", size: "sm", wrap: true })}
          onClick={() => {
            setConfirming(false);
            run(remove({ campaignId, userId: member.userId }));
          }}
        >
          Remove
        </button>
        <button type="button" className={glassButtonClass({ role: "cancel", size: "sm", wrap: true })} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="cfg-pl-menu-wrap"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          // Escape closes the menu, not the settings dialog around it.
          event.stopPropagation();
          event.preventDefault();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={glassButtonClass({ role: "tool", size: "sm" })}
        aria-label={`Options for ${member.name}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        ···
      </button>
      {open ? (
        <ul id={menuId} className="cfg-pl-menu" aria-label={`Options for ${member.name}`}>
          {actions.toggleCoGm ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  run(setCoGm({ campaignId, userId: member.userId, coGm: !member.coGm }));
                }}
              >
                {member.coGm ? "Remove co-GM" : "Make co-GM"}
              </button>
            </li>
          ) : null}
          {actions.remove ? (
            <li>
              <button
                type="button"
                className="cfg-pl-menu-danger"
                onClick={() => {
                  setOpen(false);
                  setConfirming(true);
                }}
              >
                Remove from campaign
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The roster (design `.pl` rows): the creator ('Owner'), then co-GMs and players with what they play, a 'Co-GM' badge,
 * the presence slot (U3p) and the '···' menu. `viewerIsCreator` is the campaign's `isCreator` (display only).
 */
export function PlayerRoster({ campaignId, viewerIsCreator }: { campaignId: Id<"campaigns">; viewerIsCreator: boolean }) {
  const roster = useQuery(api.members.roster, { campaignId });
  const characters = useQuery(api.charactersReads.listByCampaign, { campaignId });
  const [error, setError] = useState<string | null>(null);

  if (roster === undefined) {
    return (
      <p role="status" className="cfg-muted">
        Loading …
      </p>
    );
  }
  const firstOf = (userId: string) => characters?.find((c) => c.ownerId === userId && c.corrupt !== true);
  // Co-GMs first, then players; each group in join order.
  const members = [...roster.players].sort((a, b) => Number(b.coGm) - Number(a.coGm) || a.joinedAt - b.joinedAt);

  return (
    <>
      <ul className="cfg-pl-list" aria-label="People in this campaign">
        <li className="cfg-pl">
          <span className="cfg-face cfg-face-gm cfg-pl-face">
            <span aria-hidden="true">GM</span>
          </span>
          <div className="cfg-row-t">
            <b>{viewerIsCreator ? "You" : roster.gm.name}</b>
            <span>Game Master</span>
          </div>
          <span className="cfg-pl-role">Owner</span>
        </li>
        {members.map((m) => {
          const line = playsLine(m.userId, characters);
          return (
            <li key={m.userId} className="cfg-pl" data-testid={`settings-member-${m.name}`}>
              <Face name={m.name} character={firstOf(m.userId)} />
              <div className="cfg-row-t">
                <b>{m.name}</b>
                <span>{line ?? (characters === undefined ? "…" : "No character yet")}</span>
              </div>
              {m.coGm ? <span className="cfg-pl-role">Co-GM</span> : null}
              <PresenceSlot campaignId={campaignId} userId={m.userId} />
              <RowMenu member={m} campaignId={campaignId} viewerIsCreator={viewerIsCreator} onError={setError} />
            </li>
          );
        })}
      </ul>
      {members.length === 0 ? <p className="cfg-muted">No players yet. Share the link below.</p> : null}
      {error ? (
        <p role="alert" className="cfg-pl-err">
          {error}
        </p>
      ) : null}
    </>
  );
}
