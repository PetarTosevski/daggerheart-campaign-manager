"use client";

import type { ReactNode } from "react";

import { assetBackground } from "@/lib/design-assets";
import {
  getAncestry,
  getClass,
  getDomain,
  getSubclass,
  getTransformation,
  PORTRAITS,
  subclassesForClass,
  TRAIT_IDS,
  type DomainId,
  type Feature,
  type TraitId,
} from "@/lib/srd";
import { TRAIT_POOL } from "@/lib/domain/characters";
import { cn } from "@/lib/utils";
import { pronounsFieldLabel } from "@/lib/validation/characters";

import {
  assignTrait,
  availableAncestries,
  availableClasses,
  availableCommunities,
  portraitOptions,
  suggestedTraits,
  type WizardOptions,
  type WizardState,
} from "./wizard-logic";

export type StepProps = {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  opts: WizardOptions;
};

/** Domain icons from the Party board (.dom-* rules). */
const DOMAIN_ICONS: Record<DomainId, string> = {
  arcana: "dbed3c9d6a72831c3c1947f041778474",
  blade: "3269197f5cbf0e70936015d2d16cbbcb",
  bone: "6b9a054e5e6a373f1ff6f54c4e337612",
  codex: "851048dfc8fa331e4cd77c16c40a4167",
  grace: "da4640f852b6ab28b37e87f8910caff9",
  midnight: "00781088d1823e6e9800092acb9e2152",
  sage: "903ded076fded425a8adcea4c91e1173",
  splendor: "d5deed750bc84bc6862cdd8853d4a282",
  valor: "37376d440b57ebf60e14f9cdc002e754",
  dread: "43e1316c00829c7caebd8ca07c094984",
};

/** The board's class banner: the two domain colours with faint rings. */
function classBanner(domains: readonly DomainId[]): string {
  const [a, b] = domains.map((d) => getDomain(d)?.color ?? "#5b2b2b");
  return `radial-gradient(circle at 84% 50%, rgba(255,255,255,.10) 0 16%, transparent 17%), radial-gradient(circle at 84% 50%, transparent 0 24%, rgba(255,255,255,.08) 25% 27%, transparent 28%), radial-gradient(circle at 70% 20%, transparent 0 9%, rgba(255,255,255,.07) 10% 11%, transparent 12%), radial-gradient(ellipse at 50% 120%, rgba(0,0,0,.35), transparent 60%), linear-gradient(100deg, ${a} 0%, ${a} 34%, ${b ?? a} 66%, ${b ?? a} 100%)`;
}

export function HopeFearTag() {
  return (
    <span className="wz-hftag" aria-label="Hope and Fear">
      <span className="text-[#f0cf8a]">Hope</span>
      <span className="text-[#9a8cc4]">&amp;</span>
      <span className="text-[#c6b6f2]">Fear</span>
    </span>
  );
}

export function HfMini() {
  return (
    <span className="wz-hf" aria-label="Hope and Fear">
      H&amp;F
    </span>
  );
}

/** A native radio (or checkbox) inside a styled label. */
export function Choice({
  type = "radio",
  name,
  checked,
  onSelect,
  disabled,
  className,
  style,
  label,
  children,
}: {
  type?: "radio" | "checkbox";
  /** Accessible name when the visible text alone is ambiguous. */
  label?: string;
  name: string;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <label className={cn("wz-choice", className)} style={style}>
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={onSelect} aria-label={label} />
      {children}
    </label>
  );
}

/** A fieldset reset to look like the board's labelled groups. */
export function Group({ legend, children, className, legendClass }: { legend: ReactNode; children: ReactNode; className?: string; legendClass?: string }) {
  return (
    <fieldset className={cn("m-0 flex min-w-0 flex-col gap-2 border-0 p-0", className)}>
      <legend className={cn("wz-lbl mb-2 p-0", legendClass)}>{legend}</legend>
      {children}
    </fieldset>
  );
}

function Features({ features }: { features: readonly Feature[] }) {
  return features.map((f) => (
    <span key={f.name} className="whitespace-pre-line">
      <strong>{f.name}:</strong> {f.text}
    </span>
  ));
}

// ---------------------------------------------------------------- Step 1

export function ClassStep({ state, update, opts }: StepProps) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  const sub = state.subclassId ? getSubclass(state.subclassId) : undefined;
  return (
    <div className="flex flex-col gap-5">
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">Class</legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-3.5">
          {availableClasses(opts).map((c) => (
            <Choice
              key={c.id}
              name="class"
              checked={state.classId === c.id}
              onSelect={() => update({ classId: c.id, subclassId: null, domainCards: [], classItem: null, background: [], connections: [] })}
              className="wz-class"
            >
              <span
                className="flex items-baseline justify-between gap-2 px-3.5 py-2.5 text-[#f6ead2] [text-shadow:0_1px_3px_rgba(0,0,0,.55)]"
                style={{ background: classBanner(c.domains) }}
              >
                <span className="flex flex-col items-start gap-1">
                  <span className="font-display text-[22px] font-bold">{c.name}</span>
                  {c.source === "hope-and-fear" ? <HopeFearTag /> : null}
                </span>
                <span className="flex items-center gap-2">
                  {c.domains.map((d) => (
                    <span key={d} className="flex flex-col items-center gap-px">
                      <span className="wz-dom" aria-hidden="true" style={{ backgroundImage: assetBackground(DOMAIN_ICONS[d]) }} />
                      <span className="text-[12px] tracking-[0.06em]">{getDomain(d)?.name}</span>
                    </span>
                  ))}
                </span>
              </span>
              <span className="flex flex-col gap-1.5 px-3.5 py-3">
                <span className="flex flex-wrap gap-2">
                  <span className="wz-pill-stat">Evasion {c.startingEvasion}</span>
                  <span className="wz-pill-stat">HP {c.startingHp}</span>
                  <span className="wz-pill-stat">Stress 6</span>
                </span>
                <span className="text-[16px] leading-snug">
                  <strong className="font-semibold">{c.hopeFeature.name}:</strong> {c.hopeFeature.text}
                </span>
                <span className="text-[15px] text-[#6a5236]">
                  Subclasses: {c.subclasses.map((id) => getSubclass(id)?.name ?? id).join(" or ")}
                </span>
              </span>
            </Choice>
          ))}
        </div>
      </fieldset>

      {cls ? (
        <fieldset className="wz-panel m-0 min-w-0">
          <legend className="sr-only">Subclass for {cls.name}</legend>
          <div className="wz-ph" aria-hidden="true">
            <span className="wz-lbl">Subclass for {cls.name}</span>
            <span className="wz-hint">Take its Foundation card</span>
          </div>
          <div className="wz-tiles">
            {subclassesForClass(cls.id).map((s) => {
              const art = PORTRAITS[`sub-${s.id}`];
              return (
                <Choice key={s.id} name="subclass" checked={state.subclassId === s.id} onSelect={() => update({ subclassId: s.id })} className="wz-tile">
                  <span
                    className="wz-art"
                    aria-hidden="true"
                    style={art ? { backgroundImage: assetBackground(art.asset), backgroundPosition: art.position } : undefined}
                  />
                  <span className="wz-tile-n">{s.name}</span>
                </Choice>
              );
            })}
          </div>
          {sub ? (
            <div className="wz-info">
              {sub.description ? <span className="italic">{sub.description}</span> : null}
              <span className="wz-tag">{sub.spellcastTrait ? `Spellcast trait: ${traitLabel(sub.spellcastTrait)}` : "No Spellcast trait"}</span>
              <Features features={sub.foundation} />
            </div>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Step 2

function HeritageInfo({ name, features, art, hf, extra }: { name: string; features: readonly Feature[]; art?: { asset: string; position: string }; hf: boolean; extra?: ReactNode }) {
  return (
    <div className="wz-her" aria-live="polite">
      {art ? (
        <div className="wz-her-art wz-art" aria-hidden="true" style={{ backgroundImage: assetBackground(art.asset), backgroundPosition: art.position }} />
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2 font-display font-bold">
          {name} {hf ? <HopeFearTag /> : null}
          {extra}
        </span>
        <Features features={features} />
      </div>
    </div>
  );
}

export function HeritageStep({ state, update, opts }: StepProps) {
  const ancestries = availableAncestries(opts);
  const communities = availableCommunities(opts);
  const single = state.ancestryMode === "single" && state.ancestryId ? getAncestry(state.ancestryId) : undefined;
  const community = communities.find((c) => c.id === state.communityId);
  const shapeshifter = getTransformation("shapeshifter");
  const form = state.shapeForm ? getAncestry(state.shapeForm) : undefined;
  const first = state.mixedFirst ? getAncestry(state.mixedFirst) : undefined;
  const second = state.mixedSecond ? getAncestry(state.mixedSecond) : undefined;
  const mixed = state.ancestryMode === "mixed";

  return (
    <div className="flex flex-col gap-[18px]">
      <p className="wz-lead">
        Your heritage combines your <strong>ancestry</strong> (your lineage and physical traits) and your <strong>community</strong> (the culture or environment you come
        from). Each grants features.
      </p>

      <Group legend="Ancestry">
        <div className="flex flex-wrap gap-2">
          {ancestries.map((a) => (
            <Choice
              key={a.id}
              name="ancestry"
              checked={state.ancestryMode === "single" && state.ancestryId === a.id}
              onSelect={() => update({ ancestryMode: "single", ancestryId: a.id })}
              className="wz-chip"
            >
              {a.name}
              {a.source === "hope-and-fear" ? <HfMini /> : null}
            </Choice>
          ))}
          {opts.hopeAndFear && shapeshifter ? (
            <Choice name="ancestry" checked={state.ancestryMode === "shapeshifter"} onSelect={() => update({ ancestryMode: "shapeshifter" })} className="wz-chip shape">
              Shapeshifter
              <span className="wz-tr">Transformation</span>
            </Choice>
          ) : null}
        </div>
        {single ? (
          <HeritageInfo name={single.name} features={single.features} art={PORTRAITS[`anc-${single.id}`]} hf={single.source === "hope-and-fear"} />
        ) : null}
      </Group>

      <button type="button" className="wz-mxbtn" aria-pressed={mixed} onClick={() => update({ ancestryMode: mixed ? null : "mixed" })}>
        <span aria-hidden="true" className="text-[18px] leading-none">
          ◩
        </span>
        Or create your unique mixed ancestry
      </button>

      {mixed ? (
        <section className="wz-panel wz-mx" aria-label="Mixed ancestry">
          <div className="wz-ph">
            <span className="wz-lbl text-[#7a4a1a]">Mixed ancestry</span>
            <span className="wz-hint">Take the top feature of the first, the bottom feature of the second</span>
          </div>
          <Group legend="First ancestry · gives its top feature" legendClass="text-[12px]">
            <div className="flex flex-wrap gap-2">
              {ancestries.map((a) => (
                <Choice
                  key={a.id}
                  name="mixed-first"
                  checked={state.mixedFirst === a.id}
                  onSelect={() => update({ mixedFirst: a.id, mixedSecond: state.mixedSecond === a.id ? null : state.mixedSecond })}
                  className="wz-chip"
                >
                  {a.name}
                  {a.source === "hope-and-fear" ? <HfMini /> : null}
                </Choice>
              ))}
            </div>
          </Group>
          <Group legend="Second ancestry · gives its bottom feature" legendClass="text-[12px]" className="mt-1.5">
            <div className="flex flex-wrap gap-2">
              {ancestries.map((a) => (
                <Choice
                  key={a.id}
                  name="mixed-second"
                  checked={state.mixedSecond === a.id}
                  disabled={a.id === state.mixedFirst}
                  onSelect={() => update({ mixedSecond: a.id })}
                  className="wz-chip"
                >
                  {a.name}
                  {a.source === "hope-and-fear" ? <HfMini /> : null}
                </Choice>
              ))}
            </div>
          </Group>
          <div className="mt-1.5 flex flex-col gap-1.5">
            <label htmlFor="cc-mxname" className="wz-lbl text-[12px]">
              Name your heritage (optional)
            </label>
            <input
              id="cc-mxname"
              className="wz-in max-w-[420px]"
              type="text"
              maxLength={80}
              placeholder={first && second ? `${first.name}-${second.name}` : "e.g. Elf-Orc"}
              value={state.mixedName}
              onChange={(e) => update({ mixedName: e.target.value })}
            />
          </div>
          {first && second ? (
            <HeritageInfo
              name={state.mixedName.trim() || `${first.name}-${second.name}`}
              features={[first.features[0], second.features[1]].filter(Boolean)}
              hf={false}
              extra={<span className="font-serif text-[15px] font-normal italic">Top feature from {first.name} · bottom feature from {second.name}</span>}
            />
          ) : null}
        </section>
      ) : null}

      {state.ancestryMode === "shapeshifter" && shapeshifter ? (
        <section className="wz-panel wz-ss" aria-label="Shapeshifter form">
          <p className="m-0 text-[16px] leading-snug">{shapeshifter.description}</p>
          <Group legend={<span className="text-[#4a2a7a]">Your current form</span>}>
            <span className="wz-hint -mt-1">Change Shape lets you swap it during a rest</span>
            <div className="flex flex-wrap gap-2">
              {ancestries.map((a) => (
                <Choice key={a.id} name="shape-form" checked={state.shapeForm === a.id} onSelect={() => update({ shapeForm: a.id, shapeFeature: null })} className="wz-chip">
                  {a.name}
                  {a.source === "hope-and-fear" ? <HfMini /> : null}
                </Choice>
              ))}
            </div>
          </Group>
          {form ? (
            <Group legend={<span className="text-[#4a2a7a]">Only Skin Deep: keep one feature</span>} className="mt-1">
              <div className="wz-gears">
                {form.features.map((f) => (
                  <Choice key={f.name} name="shape-feature" checked={state.shapeFeature === f.name} onSelect={() => update({ shapeFeature: f.name })} className="wz-gear">
                    <span className="wz-gn">{f.name}</span>
                    <span className="wz-gf not-italic">{f.text}</span>
                  </Choice>
                ))}
              </div>
            </Group>
          ) : null}
        </section>
      ) : null}

      <Group legend="Community">
        <div className="flex flex-wrap gap-2">
          {communities.map((c) => (
            <Choice key={c.id} name="community" checked={state.communityId === c.id} onSelect={() => update({ communityId: c.id })} className="wz-chip">
              {c.name}
              {c.source === "hope-and-fear" ? <HfMini /> : null}
            </Choice>
          ))}
        </div>
        {community ? (
          <HeritageInfo name={community.name} features={[community.feature]} art={PORTRAITS[`com-${community.id}`]} hf={community.source === "hope-and-fear"} />
        ) : null}
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------- Step 3

const TRAITS: Record<TraitId, { label: string; verbs: string }> = {
  agility: { label: "Agility", verbs: "Sprint · Leap · Maneuver" },
  strength: { label: "Strength", verbs: "Lift · Smash · Grapple" },
  finesse: { label: "Finesse", verbs: "Control · Hide · Tinker" },
  instinct: { label: "Instinct", verbs: "Perceive · Sense · Navigate" },
  presence: { label: "Presence", verbs: "Charm · Perform · Deceive" },
  knowledge: { label: "Knowledge", verbs: "Recall · Analyze · Comprehend" },
};

export const traitLabel = (t: TraitId) => TRAITS[t].label;

export const formatModifier = (v: number) => (v > 0 ? `+${v}` : v === 0 ? "+0" : `−${Math.abs(v)}`);

export function TraitsStep({ state, update }: StepProps) {
  const values = [2, 1, 0, -1];
  const used = (v: number) => TRAIT_IDS.filter((t) => state.traits[t] === v).length;
  const copies = (v: number) => TRAIT_POOL.filter((x) => x === v).length;
  const suggestion = suggestedTraits(state.classId);
  const pool = TRAIT_POOL.map((v, i) => ({ v, used: TRAIT_POOL.slice(0, i).filter((x) => x === v).length < used(v) }));
  return (
    <div className="flex flex-col gap-4">
      <p className="wz-lead">
        Assign the modifiers <strong>+2, +1, +1, +0, +0, −1</strong> to your six traits in any order. When you “roll with a trait,” its modifier is added to the roll.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="wz-poolrow">
          <span className="wz-lbl" id="cc-pool">
            Left to assign
          </span>
          <span className="contents" role="list" aria-labelledby="cc-pool">
            {pool.map((p, i) => (
              <span key={i} role="listitem" className={cn("wz-pool", p.used && "used")} aria-label={`${formatModifier(p.v)}${p.used ? " (assigned)" : ""}`}>
                {formatModifier(p.v)}
              </span>
            ))}
          </span>
        </div>
        <span className="flex gap-2">
          {suggestion ? (
            <button type="button" className="wz-ghost" onClick={() => update({ traits: suggestion })}>
              Use suggested
            </button>
          ) : null}
          <button type="button" className="wz-ghost" onClick={() => update({ traits: {} })}>
            Clear
          </button>
        </span>
      </div>
      <div className="wz-traits">
        {TRAIT_IDS.map((t) => {
          const value = state.traits[t];
          return (
            <div key={t} role="radiogroup" aria-labelledby={`cc-trait-${t}`} className="wz-trait">
              <span className={cn("wz-tval", value !== undefined && "set")} aria-hidden="true">
                {value !== undefined ? formatModifier(value) : "—"}
              </span>
              <span className="flex min-w-[120px] flex-1 flex-col gap-0.5">
                <strong id={`cc-trait-${t}`} className="font-display text-[17px]">
                  {TRAITS[t].label}
                </strong>
                <span className="text-[14px] text-[#6a5236] italic">{TRAITS[t].verbs}</span>
              </span>
              <span className="ml-auto flex gap-1">
                {values.map((v) => {
                  const full = value !== v && used(v) >= copies(v);
                  return (
                    <Choice
                      key={v}
                      name={`trait-${t}`}
                      checked={value === v}
                      onSelect={() => update({ traits: assignTrait(state.traits, t, v) })}
                      className={cn("wz-mod", full && "full")}
                      label={`${TRAITS[t].label} ${formatModifier(v)}`}
                    >
                      {formatModifier(v)}
                    </Choice>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Step 4

export function InfoStep({ state, update }: StepProps) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  const portraits = portraitOptions(state).filter((p) => PORTRAITS[p.key]);
  const current = state.portrait ?? portraits[0]?.key ?? "none";
  const stats = cls
    ? [
        ["Level", "1", "You start a new campaign at Level 1."],
        ["Evasion", String(cls.startingEvasion), "Your class’s starting Evasion. Armor and weapon features adjust it in the next step."],
        ["Hit Points", String(cls.startingHp), "Your starting HP is set by your class."],
        ["Stress", "6", "Every PC starts with 6 Stress slots."],
        ["Hope", "2", "All PCs start with 2 Hope."],
      ]
    : [];
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cc-name" className="wz-lbl flex min-h-8 items-center">
            Character name
          </label>
          <input id="cc-name" className="wz-in" type="text" maxLength={80} placeholder="Name your hero" value={state.name} onChange={(e) => update({ name: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex min-h-8 items-center justify-between gap-2">
            <label htmlFor="cc-pron" className="wz-lbl">
              {pronounsFieldLabel(state.pronounsLabel)}
            </label>
            {/* Label only (dcm-bxp.35): the text stays the same whichever label is shown. */}
            <button
              type="button"
              role="switch"
              aria-checked={state.pronounsLabel === "pronouns"}
              aria-label="Label as Pronouns"
              className="wz-hint flex items-center gap-1.5 bg-transparent p-0 text-[13px]"
              onClick={() => update({ pronounsLabel: state.pronounsLabel === "pronouns" ? "gender" : "pronouns" })}
            >
              <span aria-hidden="true" className={cn("relative inline-block h-4 w-7 rounded-full border border-current transition-colors", state.pronounsLabel === "pronouns" && "bg-current")}>
                <span
                  className={cn(
                    "absolute top-[2px] left-[2px] h-2.5 w-2.5 rounded-full bg-current transition-transform",
                    state.pronounsLabel === "pronouns" && "translate-x-3 bg-[#0f0d15]",
                  )}
                />
              </span>
              Pronouns
            </button>
          </div>
          <input
            id="cc-pron"
            className="wz-in"
            type="text"
            maxLength={80}
            placeholder={state.pronounsLabel === "pronouns" ? "e.g. she/her, they/them (optional)" : "Optional"}
            value={state.pronouns}
            onChange={(e) => update({ pronouns: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cc-desc" className="wz-lbl">
          Description (optional)
        </label>
        {cls && (cls.clothes || cls.attitude) ? (
          <p id="cc-desc-hint" className="wz-hint m-0">
            {cls.clothes ? `Clothes: ${cls.clothes}. ` : ""}
            {cls.attitude ? `Attitude like ${cls.attitude}.` : ""}
          </p>
        ) : null}
        <textarea
          id="cc-desc"
          className="wz-ta"
          maxLength={2000}
          aria-describedby={cls && (cls.clothes || cls.attitude) ? "cc-desc-hint" : undefined}
          value={state.description}
          onChange={(e) => update({ description: e.target.value })}
        />
      </div>
      <Group legend="Portrait">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5">
          {portraits.map((p) => {
            const art = PORTRAITS[p.key];
            return (
              <Choice key={p.key} name="portrait" checked={current === p.key} onSelect={() => update({ portrait: p.key })} className="wz-tile">
                <span className="wz-portrait" aria-hidden="true" style={{ backgroundImage: assetBackground(art.asset), backgroundPosition: art.position }} />
                <span className="wz-tile-n text-[15px]">{p.label}</span>
              </Choice>
            );
          })}
          <Choice name="portrait" checked={current === "none"} onSelect={() => update({ portrait: "none" })} className="wz-tile">
            <span className="wz-portrait flex items-center justify-center font-display text-[40px] text-[#e3d2ad]" aria-hidden="true">
              {(state.name.trim() || cls?.name || "?").charAt(0).toUpperCase()}
            </span>
            <span className="wz-tile-n text-[15px]">No portrait</span>
          </Choice>
        </div>
      </Group>
      <div className="wz-stats">
        {stats.map(([label, value, detail]) => (
          <div key={label} className="wz-stat">
            <span className="wz-statv">{value}</span>
            <span className="wz-lbl">{label}</span>
            <span className="text-[14px] leading-snug text-[#6a5236]">{detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
