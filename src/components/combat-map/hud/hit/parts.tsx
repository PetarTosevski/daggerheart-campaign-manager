"use client";

import { useId, useState, type CSSProperties } from "react";

import { DOMAINS } from "@/lib/srd/domains";
import { cn } from "@/lib/utils";

import {
  defaultPicks,
  grantAmount,
  grantMax,
  reactionCard,
  situationsConfirmed,
  type FeaturePicks,
  type FeatureView,
  type GrantView,
} from "../../actions/reactions/model";
import { ChoiceRow, Stepper, hudButtonClass } from "../ui";
import { grantNote, grantUnit, keepGrant, type PreviewRow, type ThresholdTile } from "./model";

/** The three threshold tiles, the hit's severity lit (Main `.hc-th`). */
export function Tiles({ tiles }: { tiles: readonly ThresholdTile[] }) {
  return (
    <ul className="hud-hit-th" aria-label="Damage thresholds">
      {tiles.map((t) => (
        <li key={t.severity} className={cn(t.on && "on")} aria-current={t.on ? "true" : undefined}>
          {t.label}
          <small>{t.hp} HP</small>
        </li>
      ))}
    </ul>
  );
}

/**
 * HP / Armor before → after (Main `.hc-pv`): pips show what is left now, the ones this answer marks hollow; the text
 * says what is marked (answer 2).
 */
export function Preview({ rows }: { rows: readonly PreviewRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="hud-hit-pv" data-testid="hud-hit-preview">
      {rows.map((r) => {
        const leftNow = r.max - r.before;
        const leftAfter = r.max - r.after;
        return (
          <div key={r.kind} className="hud-hit-pv-row">
            <span className="hud-hit-pv-l">{r.label}</span>
            <span className={cn("hud-pp", r.kind === "hp" ? "hud-pp-hp" : "hud-pp-armor")} role="img" aria-label={r.aria}>
              {Array.from({ length: Math.max(0, r.max) }, (_, i) => (
                <i key={i} className={i < leftAfter ? "on" : i < leftNow ? "hud-hit-lose" : undefined} />
              ))}
            </span>
            <em data-testid={`hud-hit-${r.kind}`}>{r.text}</em>
          </div>
        );
      })}
    </div>
  );
}

/** A reaction card that answers this hit: its domain colour, name, level and text, and Use (CmpCards 'Reaction'). */
function CardRow({ cardId, disabled, onUse }: { cardId: string; disabled: boolean; onUse: () => void }) {
  const card = reactionCard(cardId);
  const domain = DOMAINS.find((d) => d.id === card.domain);
  return (
    <li className="hud-hit-rc" style={{ "--hud-hit-dc": domain?.color ?? "#5b2b2b" } as CSSProperties} data-testid="hud-hit-card">
      <div className="hud-hit-rc-h">
        <h3>{card.name}</h3>
        <span>
          {domain?.name ?? card.domain}
          {card.level > 0 ? ` ${card.level}` : ""} · Reaction
        </span>
      </div>
      {card.text ? <p>{card.text}</p> : null}
      <button type="button" className={hudButtonClass("primary")} disabled={disabled} onClick={onUse} aria-label={`Use ${card.name}`}>
        Use
      </button>
    </li>
  );
}

/**
 * A feature that answers this hit (Iron Will, Not This Time, …) and what its Use asks: a count (stepper), a pick
 * (radio rows), an optional step or a situation to confirm (box rows). Use sends it with those picks.
 */
function FeatureRow({ feature, disabled, onUse }: { feature: FeatureView; disabled: boolean; onUse: (picks: FeaturePicks) => void }) {
  const [picks, setPicks] = useState<FeaturePicks>(() => defaultPicks(feature));
  const ready = situationsConfirmed(feature, picks);
  return (
    <li className="hud-hit-rc hud-hit-feat" data-testid="hud-hit-feature">
      <div className="hud-hit-rc-h">
        <h3>{feature.name}</h3>
        <span>Feature</span>
      </div>
      {feature.text ? <p>{feature.text}</p> : null}
      {feature.numbers.map((n) => {
        const min = Math.max(1, n.min);
        const value = picks.numbers[n.id] ?? min;
        return (
          <div key={n.id} className="hud-hit-split">
            <span>{n.label}</span>
            <Stepper
              label={n.label}
              value={value}
              min={min}
              max={Number.MAX_SAFE_INTEGER}
              disabled={disabled}
              onStep={(d) => setPicks((p) => ({ ...p, numbers: { ...p.numbers, [n.id]: Math.max(min, (p.numbers[n.id] ?? min) + d) } }))}
            />
          </div>
        );
      })}
      {feature.options.map((o) => (
        <div key={o.id} role="radiogroup" aria-label={o.label} className="hud-hit-opts">
          {o.options.map((opt) => (
            <ChoiceRow
              key={opt.id}
              type="radio"
              checked={picks.options[o.id] === opt.id}
              label={opt.label}
              disabled={disabled}
              onSelect={() => setPicks((p) => ({ ...p, options: { ...p.options, [o.id]: opt.id } }))}
            />
          ))}
        </div>
      ))}
      {feature.optionals.map((o) => (
        <ChoiceRow
          key={o.id}
          type="checkbox"
          checked={picks.optionals[o.id] === true}
          label={o.label}
          disabled={disabled}
          onSelect={() => setPicks((p) => ({ ...p, optionals: { ...p.optionals, [o.id]: !(p.optionals[o.id] === true) } }))}
        />
      ))}
      {feature.situations.map((text) => (
        <ChoiceRow
          key={text}
          type="checkbox"
          checked={picks.situations[text] === true}
          label={text}
          disabled={disabled}
          onSelect={() => setPicks((p) => ({ ...p, situations: { ...p.situations, [text]: !(p.situations[text] === true) } }))}
        />
      ))}
      <button type="button" className={hudButtonClass("primary")} disabled={disabled || !ready} onClick={() => onUse(picks)} aria-label={`Use ${feature.name}`}>
        Use
      </button>
    </li>
  );
}

/** The cards and features that answer this hit (in the order the player picks, CB p.107). */
export function Reactions({
  cardIds,
  features,
  disabled,
  onCard,
  onFeature,
}: {
  cardIds: readonly string[];
  features: readonly FeatureView[];
  disabled: boolean;
  onCard: (cardId: string) => void;
  onFeature: (feature: FeatureView, picks: FeaturePicks) => void;
}) {
  if (cardIds.length + features.length === 0) return null;
  return (
    <section className="hud-hit-react" aria-label="Reactions that answer">
      <p className="hud-hit-kicker">Answer with</p>
      <ul>
        {features.map((f) => (
          <FeatureRow key={f.featureId} feature={f} disabled={disabled} onUse={(picks) => onFeature(f, picks)} />
        ))}
        {cardIds.map((id) => (
          <CardRow key={id} cardId={id} disabled={disabled} onUse={() => onCard(id)} />
        ))}
      </ul>
    </section>
  );
}

/**
 * "Pay something else?" (CmpPromptsPlayer): the attacker's grants as the engine offers them (Hope for fewer forced HP,
 * gold instead of HP), each with the engine's own words and most; a stepper for how much; "Spend n …". Folded until
 * asked; the hit's own footer stays the way to take the HP.
 */
export function PayElse({ grants, comingHp, disabled, onSpend }: { grants: readonly GrantView[]; comingHp: number; disabled: boolean; onSpend: (grant: GrantView, amount: number) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const bodyId = useId();
  if (grants.length === 0) return null;
  const grant = keepGrant(grants, picked);
  const amount = grant ? grantAmount(grant, amounts[grant.id] ?? grantMax(grant)) : 1;
  return (
    <section className="hud-hit-else" aria-label="Pay something else?" data-testid="hud-hit-pay-else">
      <button type="button" className="hud-hit-else-t" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        Pay something else?
        <small>{comingHp > 0 ? `${comingHp} HP coming` : "In the hit window"}</small>
      </button>
      {open && grant ? (
        <div id={bodyId} className="hud-hit-else-b">
          <div role="radiogroup" aria-label="Pay with" className="hud-hit-opts">
            {grants.map((g) => (
              <ChoiceRow key={g.id} type="radio" checked={g.id === grant.id} label={g.label} note={grantNote(g)} disabled={disabled} onSelect={() => setPicked(g.id)} />
            ))}
          </div>
          <div className="hud-hit-split">
            <span>{grantUnit(grant).label}</span>
            <Stepper
              label={grantUnit(grant).label}
              value={amount}
              min={1}
              max={grantMax(grant)}
              disabled={disabled}
              onStep={(d) => setAmounts((a) => ({ ...a, [grant.id]: grantAmount(grant, amount + d) }))}
            />
          </div>
          <button type="button" className={hudButtonClass("primary")} disabled={disabled} onClick={() => onSpend(grant, amount)}>
            {grantUnit(grant).spend(amount)}
          </button>
        </div>
      ) : null}
    </section>
  );
}
