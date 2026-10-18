import type { ReactNode } from "react";

import { attackLabel, experienceLabel, textBlocks, thresholdsLabel, typeLabel } from "@/lib/adversaries/catalogue";
import { getPublishedFrame } from "@/lib/frames";
import type { AdversaryDef, AdversaryFeatureKind } from "@/lib/srd/types";

/**
 * The fields the parchment stat block reads. An SRD `AdversaryDef` fits it, and so does a custom adversary row
 * (A5: no source or page, a numeric countdown) or an instance's snapshot joined with its definition (A4).
 */
export type StatBlockAdversary = Pick<
  AdversaryDef,
  "name" | "tier" | "type" | "hordePerHp" | "description" | "motives" | "difficulty" | "thresholds" | "hp" | "experiences"
> & {
  stress: number | null;
  attack: { modifier: number | string; name: string; range: string; damage: string };
  features: readonly { name: string; kind: AdversaryFeatureKind; text: string; fearCost?: number; countdown?: string | number }[];
  source?: AdversaryDef["source"];
  frameId?: string;
  page?: number;
};

export type StatBlockProps = {
  adversary: StatBlockAdversary;
  /** Rendered in the head beside the name (A3: "Add to encounter"). */
  actions?: ReactNode;
  /** Rendered above the features, where the board drew its pip tracker (A4: the instance's HP and Stress). */
  tracker?: ReactNode;
};

const KIND_LABEL: Record<AdversaryFeatureKind, string> = { passive: "Passive", action: "Action", reaction: "Reaction", evolution: "Evolution" };

/** The board's Hope & Fear pill. */
export function HopeFearPill({ large }: { large?: boolean }) {
  return (
    <span className={large ? "adc-hf adc-hf-lg" : "adc-hf"} aria-label="Hope and Fear" role="img">
      <i className="adc-hf-hope">Hope</i>
      <i className="adc-hf-amp">&amp;</i>
      <i className="adc-hf-fear">Fear</i>
    </span>
  );
}

/** "Hope & Fear · Reign of the Weredragon · p. 143" for Hope & Fear entries; null for Core and custom ones. */
function sourceLine(adversary: StatBlockAdversary): string | null {
  if (adversary.source !== "hope-and-fear") return null;
  const frame = adversary.frameId ? getPublishedFrame(adversary.frameId)?.name : undefined;
  return ["Hope & Fear", frame, adversary.page === undefined ? undefined : `p. ${adversary.page}`].filter(Boolean).join(" · ");
}

function FeatureText({ text }: { text: string }) {
  return (
    <>
      {textBlocks(text).map((block, i) =>
        block.kind === "p" ? (
          <p key={i} className="adc-ftext">
            {block.text}
          </p>
        ) : (
          <ul key={i} className="adc-flist">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}

/** Parchment stat block in the Adversaries board's look (board lines 107-128); used by the catalogue, tracker and custom editor. */
export function StatBlock({ adversary, actions, tracker }: StatBlockProps) {
  const source = sourceLine(adversary);
  const experience = experienceLabel(adversary.experiences);
  return (
    <article className="adc-sb" aria-label={`${adversary.name} stat block`}>
      <div className="adc-sb-head">
        <div className="adc-sb-top">
          <h2 className="adc-sb-name">{adversary.name}</h2>
          {adversary.source === "hope-and-fear" ? <HopeFearPill large /> : null}
        </div>
        <div className="adc-sb-tt">
          Tier {adversary.tier} {typeLabel(adversary)}
        </div>
        <p className="adc-sb-desc">{adversary.description}</p>
        {actions ? <div className="adc-sb-actions">{actions}</div> : null}
      </div>
      <div className="adc-sb-body">
        <div className="adc-sb-line">
          <strong>Motives &amp; Tactics</strong>
          {adversary.motives}
        </div>
        <dl className="adc-sb-stats">
          <div>
            <dt>Difficulty</dt>
            <dd>{adversary.difficulty}</dd>
          </div>
          <div>
            <dt>Thresholds</dt>
            <dd>{thresholdsLabel(adversary.thresholds)}</dd>
          </div>
          <div>
            <dt>HP</dt>
            <dd>{adversary.hp}</dd>
          </div>
          <div>
            <dt>Stress</dt>
            <dd>{adversary.stress ?? "None"}</dd>
          </div>
        </dl>
        <div className="adc-sb-atk">
          <span>
            ATK <strong>{attackLabel(adversary.attack.modifier)}</strong>
          </span>
          <span>
            <strong>{adversary.attack.name}</strong>
          </span>
          <span>{adversary.attack.range}</span>
          <span>
            <strong>{adversary.attack.damage}</strong>
          </span>
        </div>
        {experience ? (
          <div className="adc-sb-line">
            <strong>Experience</strong>
            {experience}
          </div>
        ) : null}
        {tracker}
        <h3 className="adc-sb-fh">Features</h3>
        {adversary.features.map((feature, i) => (
          <div key={`${i}-${feature.name}`} className="adc-feat">
            <div className="adc-feat-h">
              <strong>{feature.name}</strong>
              <span className={`adc-kind adc-kind-${feature.kind}`}>{KIND_LABEL[feature.kind]}</span>
              {feature.fearCost ? <span className="adc-kind adc-kind-fear">Fear {feature.fearCost}</span> : null}
              {feature.countdown !== undefined ? (
                <span className="adc-kind adc-kind-other">
                  {typeof feature.countdown === "number" ? `Countdown (${feature.countdown})` : feature.countdown}
                </span>
              ) : null}
            </div>
            <FeatureText text={feature.text} />
          </div>
        ))}
        {source ? <div className="adc-sb-src">{source}</div> : null}
      </div>
    </article>
  );
}
