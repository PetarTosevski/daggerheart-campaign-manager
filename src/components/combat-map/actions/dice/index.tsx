"use client";

import { useQuery } from "convex/react";
import dynamic from "next/dynamic";

import { useCampaign } from "@/app/(gm)/campaigns/[campaignId]/campaign-shell";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ActionsPanelProps } from "../../slots";
import { useActor } from "../targets/state";

/**
 * The map dice box and mini feed (plan combat-actions CA5, U2): the sheet's `DiceBox` in a compact layout (actions.css
 * tightens it inside `.cma-dice`); its rolls are ordinary roll-feed rows, so they show on the dashboard feed and in the
 * mini feed here. Players read only public rows (`feed.list` decides; U1).
 */

function DiceLoading() {
  return (
    <p role="status" className="cm-muted">
      Loading the dice box…
    </p>
  );
}

// CL8: the dice box carries the class-feature registry and the sheet schema; load it only where it shows.
const DiceBox = dynamic(() => import("@/components/party/dice/dice-box").then((m) => m.DiceBox), { loading: DiceLoading });

/** Player column: the compact dice box for the player's character on the map. */
export function MapDice(props: ActionsPanelProps) {
  const actor = useActor(props);
  if (!actor) return null;
  return <CharacterDice campaignId={props.campaignId} characterId={actor.characterId} />;
}

function CharacterDice({ campaignId, characterId }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> }) {
  const campaign = useCampaign();
  const character = useQuery(api.characters.get, { characterId });
  if (character === undefined) return <DiceLoading />;
  if (character === null || !character.canEdit || character.corrupt) return null;
  return (
    <div className="cma-dice" data-testid="combat-map-dice">
      <DiceBox campaignId={campaignId} character={character} hopeAndFear={Boolean(campaign.options.hopeAndFear)} />
    </div>
  );
}

/** How many rows the mini feed shows. */
export const MINI_FEED_ROWS = 6;

const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** The latest roll-feed rows (the dashboard's feed, U2): attacks, map dice and every other roll. */
export function MiniFeed({ campaignId }: Pick<ActionsPanelProps, "campaignId">) {
  const page = useQuery(api.feed.list, { campaignId, paginationOpts: { numItems: MINI_FEED_ROWS, cursor: null } });
  if (page === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading the feed…
      </p>
    );
  }
  if (page.page.length === 0) return <p className="cm-muted cma-note">No rolls yet.</p>;
  return (
    <ol className="cma-feed" aria-label="Latest rolls" data-testid="combat-mini-feed">
      {page.page.map((row) => (
        <li key={row._id} className={row.undone ? "cma-feed-row undone" : "cma-feed-row"}>
          <span className="cma-feed-time">{TIME.format(row.at)}</span>
          <span className="cma-feed-text">
            {row.summary}
            {row.undone ? <span className="cm-muted"> (undone)</span> : null}
          </span>
          {row.roll ? <strong className="cma-feed-total">{row.roll.total}</strong> : null}
        </li>
      ))}
    </ol>
  );
}
