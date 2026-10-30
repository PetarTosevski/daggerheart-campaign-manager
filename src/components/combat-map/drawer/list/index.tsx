"use client";

import { useState } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CombatMapSummary, CombatRole } from "../../slots";
import { FeatureUse } from "../use";
import { BeastformControl, D5Use, FlyingToggle, StanceControls } from "./controls";
import {
  activeForm,
  cardLabel,
  d5UseOf,
  kindBadge,
  lockedCards,
  REST_TIME_FEATURES,
  sectionsOf,
  titleCase,
  usableUses,
  useBadges,
  type Drawer,
  type DrawerFeature,
  type DrawerUse,
} from "./model";

type ListProps = {
  campaignId: Id<"campaigns">;
  role: CombatRole;
  map: CombatMapSummary | null;
  characterId: Id<"characters">;
  drawer: Drawer;
  /** False while the GM has not turned on "Play for this character": every control is greyed. */
  canAct: boolean;
};

function stateBadge(f: DrawerFeature): { text: string; tone: "off" | "info" } | null {
  if (REST_TIME_FEATURES.has(f.featureId)) return { text: "Applied at rest", tone: "info" };
  switch (f.state) {
    case "exhausted":
      return { text: f.resetLabel ? `Used · ${f.resetLabel}` : "Used", tone: "off" };
    case "outOfCombat":
      return { text: "Out of combat", tone: "info" };
    case "narrative":
      return { text: "Narrative", tone: "info" };
    default:
      return null;
  }
}

function UseRow({ feature, use, many, canAct, onUse }: { feature: DrawerFeature; use: DrawerUse; many: boolean; canAct: boolean; onUse: () => void }) {
  const label = many ? use.name : feature.name;
  const badges = useBadges(use);
  return (
    <li className="sd-use" data-ready={use.ready ? "true" : "false"}>
      {many ? <span className="sd-use-name">{use.name}</span> : null}
      <span className="sd-badges">
        {badges.map((b) => (
          <span key={b} className="sd-badge">
            {b}
          </span>
        ))}
        {use.ready && use.usesLeft !== null ? <span className="sd-badge">{use.usesLeft} left</span> : null}
        {/* One use: the feature's own "Used · <reset>" badge already says it. */}
        {many && !use.ready && use.resetLabel ? <span className="sd-badge sd-badge-off">{use.resetLabel}</span> : null}
      </span>
      <button type="button" className="cm-btn cm-sm" disabled={!canAct || !use.ready} aria-label={`Use ${label}`} onClick={onUse}>
        {use.activation === "reaction" ? "React" : "Use"}
      </button>
    </li>
  );
}

function FeatureRow({ feature, characterId, canAct, onUse }: { feature: DrawerFeature; characterId: Id<"characters">; canAct: boolean; onUse: (use: DrawerUse) => void }) {
  const state = stateBadge(feature);
  const card = cardLabel(feature.card);
  const uses = usableUses(feature);
  const d5 = d5UseOf(feature);
  return (
    <li className="sd-feature" data-feature={feature.featureId} data-state={feature.state}>
      <div className="sd-feature-head">
        <h4 className="sd-feature-name">{feature.name}</h4>
        <span className="sd-badges">
          <span className="sd-badge sd-badge-kind">{kindBadge(feature)}</span>
          {card ? <span className="sd-badge">{card}</span> : null}
          {feature.multiclass ? <span className="sd-badge">Multiclass</span> : null}
          {feature.tokens > 0 ? <span className="sd-badge">{feature.tokens} tokens</span> : null}
          {feature.upgrades.map((u) => (
            <span key={u} className="sd-badge">
              {u}
            </span>
          ))}
          {state ? <span className={state.tone === "off" ? "sd-badge sd-badge-off" : "sd-badge sd-badge-info"}>{state.text}</span> : null}
        </span>
      </div>
      <p className="sd-feature-text">{feature.text}</p>
      {uses.length > 0 ? (
        <ul className="sd-uses" aria-label={`${feature.name} uses`}>
          {uses.map((u) => (
            <UseRow key={u.useId} feature={feature} use={u} many={uses.length > 1} canAct={canAct} onUse={() => onUse(u)} />
          ))}
        </ul>
      ) : null}
      {d5 ? <D5Use characterId={characterId} canAct={canAct} featureKey={d5} name={feature.name} /> : null}
    </li>
  );
}

/**
 * Every feature the character owns, grouped by source in the order of the plan (Hope, class, subclass, ancestry,
 * community, transformation, Beastform and stances, other), each with its kind badge, cost and limit badges and Use
 * button; exhausted ones are greyed with their reset label. A Use opens `FeatureUse` (SD7). The Flying toggle shows for
 * a character holding a flying feature (Q16).
 */
export function FeatureList({ campaignId, role, map, characterId, drawer, canAct }: ListProps) {
  const [using, setUsing] = useState<{ featureId: string; useId: string } | null>(null);
  const sections = sectionsOf(drawer);
  const locks = lockedCards(drawer.features);
  const form = activeForm(drawer.features);
  const here = { campaignId, characterId, canAct };
  return (
    <div className="sd-list" data-testid="sheet-drawer-features">
      {drawer.canFly ? <FlyingToggle {...here} flying={drawer.flying} /> : null}
      {sections.length === 0 ? <p className="cm-muted">This character holds no features yet.</p> : null}
      {sections.map((s) => (
        <section key={s.id} className="sd-section" aria-labelledby={`sd-sec-${s.id}`} data-section={s.id}>
          <h3 id={`sd-sec-${s.id}`} className="sd-section-title">
            {s.title}
          </h3>
          {s.id === "form" && form ? <BeastformControl {...here} form={form} /> : null}
          {s.id === "form" && drawer.martial ? <StanceControls {...here} martial={drawer.martial} features={drawer.features} /> : null}
          <ul className="sd-features">
            {s.features.map((f) => (
              <FeatureRow key={f.featureId} feature={f} characterId={characterId} canAct={canAct} onUse={(u) => setUsing({ featureId: f.featureId, useId: u.useId })} />
            ))}
            {s.id === "subclass"
              ? locks.map((l) => (
                  <li key={`${l.owner}:${l.card}`} className="sd-feature sd-locked" data-state="locked">
                    <div className="sd-feature-head">
                      <h4 className="sd-feature-name">{titleCase(l.owner)} · {cardLabel(l.card)} card</h4>
                      <span className="sd-badge sd-badge-off">Locked</span>
                    </div>
                  </li>
                ))
              : null}
          </ul>
        </section>
      ))}
      {using ? (
        <FeatureUse
          campaignId={campaignId}
          role={role}
          map={map}
          characterId={characterId}
          featureId={using.featureId}
          useId={using.useId}
          onClose={() => setUsing(null)}
        />
      ) : null}
    </div>
  );
}
