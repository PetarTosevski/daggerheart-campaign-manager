"use client";

import Link from "next/link";

import { packsHref, type PacksLinkProps, type PacksScreenProps } from "../slots";

/**
 * Packs slot (sprite packs P8): the link to the GM's sprite packs screen and the screen itself (upload, cut,
 * label). P0 stubs: a plain link and an empty-state card. Export names and props follow
 * src/components/combat-map/slots.ts; styles come from combat-map.css (`cm-*`), P8 adds its own colocated .css.
 */

export function PacksLink({ campaignId }: PacksLinkProps) {
  return (
    <Link className="cm-btn" href={packsHref(campaignId)}>
      Sprite packs
    </Link>
  );
}

export function PacksScreen(props: PacksScreenProps) {
  void props;
  return (
    <section className="cm-card" aria-labelledby="cm-packs-empty-h">
      <h2 id="cm-packs-empty-h" className="cm-lbl">
        Your packs
      </h2>
      <p className="cm-muted">Uploading your own sprite sheets comes here. The built-in packs are always available.</p>
    </section>
  );
}
