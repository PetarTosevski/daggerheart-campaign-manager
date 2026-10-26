"use client";

import "./hero-card.css";

import { Lock } from "lucide-react";

import { assetBackground } from "@/lib/design-assets";
import type { Feature } from "@/lib/srd";

// The board's hero card (Party.dc.html .hc-card): art with a kind tag, name, tier, a sub line, feature text, an
// optional note and a lock line. Used by Domains > Heritage & Subclass and by the level-up's upgraded subclass card.

function Features({ features }: { features: readonly Feature[] }) {
  return (
    <div className="hc-fx">
      {features.map((f) => (
        <p key={f.name} className="hc-text">
          <strong>{f.name}</strong>
          {f.text ? `: ${f.text}` : ""}
        </p>
      ))}
    </div>
  );
}

export function HeroCard({
  kind,
  name,
  tier,
  sub,
  features,
  art,
  note,
  locked,
}: {
  kind: string;
  name: string;
  tier?: string;
  sub?: string;
  features: readonly Feature[];
  art?: { asset: string; position: string };
  note?: string;
  locked?: string;
}) {
  return (
    <article className={`hc-card${locked ? " locked" : ""}`} aria-label={`${kind}: ${name}${tier ? ` ${tier}` : ""}${locked ? " (locked)" : ""}`}>
      <div className="hc-top">
        <div
          className="hc-art"
          aria-hidden="true"
          style={art ? { backgroundImage: assetBackground(art.asset), backgroundPosition: art.position } : undefined}
        />
        <span className="hc-kind">{kind}</span>
      </div>
      <div className="hc-body">
        <div className="hc-head">
          <h4 className="hc-name">{name}</h4>
          {tier ? <span className="hc-tier">{tier}</span> : null}
        </div>
        {sub ? <span className="hc-sub">{sub}</span> : null}
        <Features features={features} />
        {note ? <p className="hc-note">{note}</p> : null}
        {locked ? (
          <span className="hc-lock">
            <Lock className="size-3.5" aria-hidden="true" />
            {locked}
          </span>
        ) : null}
      </div>
    </article>
  );
}
