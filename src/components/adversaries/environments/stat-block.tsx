import { Fragment, type ReactNode } from "react";

import { textBlocks } from "@/lib/adversaries/catalogue";
import { environmentTierLine } from "@/lib/domain/environments";
import type { EnvironmentDef, EnvironmentFeature, EnvironmentFeatureKind } from "@/lib/srd/types";

import { HopeFearPill } from "../catalogue/stat-block";

const KIND_LABEL: Record<EnvironmentFeatureKind, string> = { passive: "Passive", action: "Action", reaction: "Reaction" };

export type EnvironmentStatBlockProps = {
  environment: EnvironmentDef;
  /** Whether an SRD adversary is in the campaign's catalogue (Hope & Fear entries only with the switch on). */
  canOpenAdversary: (adversaryId: string) => boolean;
  /** Opens that adversary in the Catalogue tab. */
  onOpenAdversary: (adversaryId: string) => void;
  /** Shown above the name (EF1: GM Fear with "+ Fear" and the actions' status line). */
  top?: ReactNode;
  /** A feature's buttons (EF1: "Spend N Fear", "Start countdown"), under its text. */
  renderFeatureActions?: (feature: EnvironmentFeature) => ReactNode;
};

/** Feature text: paragraphs, "- " bullet lists, and numbered lists where every item starts "N. " (Deep Pockets). */
function FeatureText({ text }: { text: string }) {
  return (
    <>
      {textBlocks(text).map((block, i) => {
        if (block.kind === "p") {
          return (
            <p key={i} className="adc-ftext">
              {block.text}
            </p>
          );
        }
        const numbered = block.items.every((item) => /^\d+\. /.test(item));
        return numbered ? (
          <ol key={i} className="adc-flist env-olist">
            {block.items.map((item, j) => (
              <li key={j} value={Number(item.split(".")[0])}>
                {item.replace(/^\d+\. /, "")}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="adc-flist">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        );
      })}
    </>
  );
}

function AdversaryName({ name, adversaryId, canOpen, onOpen }: { name: string; adversaryId?: string; canOpen: (id: string) => boolean; onOpen: (id: string) => void }) {
  if (!adversaryId || !canOpen(adversaryId)) return <>{name}</>;
  return (
    <button type="button" className="env-advlink" onClick={() => onOpen(adversaryId)} aria-label={`Show the ${name} stat block`}>
      {name}
    </button>
  );
}

/** "Core Rulebook · p. 243", "Hope & Fear · p. 99". */
function sourceLine(environment: EnvironmentDef): string {
  return `${environment.source === "hope-and-fear" ? "Hope & Fear" : "Core Rulebook"} · p. ${environment.page}`;
}

/**
 * Parchment environment stat block in the adversary stat block's look (CB p.240 "Environment Breakdown"): name, tier
 * and type, description, Impulses, Difficulty, Potential Adversaries (linked to the catalogue where they are in it),
 * features with kind, Fear and countdown badges, and the italic feature questions.
 */
export function EnvironmentStatBlock({ environment, canOpenAdversary, onOpenAdversary, top, renderFeatureActions }: EnvironmentStatBlockProps) {
  return (
    <article className="adc-sb" aria-label={`${environment.name} stat block`}>
      {top ? <div className="env-sb-top">{top}</div> : null}
      <div className="adc-sb-head">
        <div className="adc-sb-top">
          <h2 className="adc-sb-name">{environment.name}</h2>
          {environment.source === "hope-and-fear" ? <HopeFearPill large /> : null}
        </div>
        <div className="adc-sb-tt">{environmentTierLine(environment)}</div>
        <p className="adc-sb-desc">{environment.description}</p>
      </div>
      <div className="adc-sb-body">
        <div className="adc-sb-line">
          <strong>Impulses</strong>
          {environment.impulses}
        </div>
        <dl className="env-sb-box">
          <div>
            <dt>Difficulty</dt>
            <dd data-testid="environment-difficulty">{environment.difficulty}</dd>
          </div>
          <div>
            <dt>Potential Adversaries</dt>
            <dd>
              {environment.potentialAdversaries.map((ref, i) => (
                <Fragment key={`${i}-${ref.name}`}>
                  {i > 0 ? ", " : null}
                  <AdversaryName name={ref.name} adversaryId={ref.adversaryId} canOpen={canOpenAdversary} onOpen={onOpenAdversary} />
                  {ref.members ? (
                    <>
                      {" "}
                      {ref.members.map((member, j) => (
                        <Fragment key={`${j}-${member.name}`}>
                          {j > 0 ? ", " : null}
                          {/* The brackets stay on the line of the first and last member. */}
                          <span className="env-nowrap">
                            {j === 0 ? "(" : null}
                            <AdversaryName name={member.name} adversaryId={member.adversaryId} canOpen={canOpenAdversary} onOpen={onOpenAdversary} />
                            {j === ref.members!.length - 1 ? ")" : null}
                          </span>
                        </Fragment>
                      ))}
                    </>
                  ) : null}
                </Fragment>
              ))}
            </dd>
          </div>
        </dl>
        <h3 className="adc-sb-fh">Features</h3>
        {environment.features.map((feature, i) => (
          <div key={`${i}-${feature.name}`} className="adc-feat">
            <div className="adc-feat-h">
              <strong>{feature.name}</strong>
              <span className={`adc-kind adc-kind-${feature.kind}`}>{KIND_LABEL[feature.kind]}</span>
              {feature.fearCost ? <span className="adc-kind adc-kind-fear">Fear {feature.fearCost}</span> : null}
              {feature.countdown ? <span className="adc-kind adc-kind-other">{feature.countdown}</span> : null}
            </div>
            <FeatureText text={feature.text} />
            {feature.questions ? <p className="env-q">{feature.questions}</p> : null}
            {renderFeatureActions?.(feature)}
          </div>
        ))}
        <div className="adc-sb-src">{sourceLine(environment)}</div>
      </div>
    </article>
  );
}
