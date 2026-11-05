"use client";

import "./rules.css";

import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { Lock, Minus, Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";
import { errorMessage } from "@/lib/convex-errors";
import type { FrameId } from "@/lib/frames";
import { isChoiceRule, isSwitchRule, isToggleRule, type ModeDef, type RuleDef, type RuleModes } from "@/lib/rules";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  applyRuleChange,
  isChanged,
  modeNotInBooks,
  modeText,
  readOnlyReason,
  ruleGroups,
  RULE_ROWS_TEXT,
  ruleTag,
  shownParam,
  type RuleChangeIntent,
} from "./model";

type RuleChange = FunctionArgs<typeof api.ruleSettings.set>["change"];

/** The live `ruleSettings.get` (every member reads it); undefined while loading. */
export function useRuleSettings(campaignId: Id<"campaigns">) {
  return useQuery(api.ruleSettings.get, { campaignId });
}

/**
 * The rule rows of House rules (plan rule-switches RU): every rule of the campaign's frame from the registry, grouped by
 * area in disclosure groups. `editable` (the GM's settings section): switchable rules the engine follows get a Book /
 * variant / Manual radio group, optional rules a switch (Shared domain cards: Allow / Warn / Refuse), each write one
 * field through `ruleSettings.set` with an optimistic update on `ruleSettings.get` (rule 12). While a session is live
 * every control is disabled with the lock hint. Without `editable` (players, from the Preferences popover) the rows show
 * the modes as text. Book-only rows never have a control.
 */
export function RuleRows({ campaignId, frameId, editable }: { campaignId: Id<"campaigns">; frameId: FrameId; editable: boolean }): ReactNode {
  const view = useRuleSettings(campaignId);
  const set = useMutation(api.ruleSettings.set).withOptimisticUpdate((store, { change }) => {
    const current = store.getQuery(api.ruleSettings.get, { campaignId });
    if (current !== undefined) store.setQuery(api.ruleSettings.get, { campaignId }, applyRuleChange(current, change));
  });
  const [error, setError] = useState<string | null>(null);

  if (view === undefined) {
    // Not role=status: the table rulings below have the section's loading line.
    return (
      <p aria-busy="true" className="cfg-muted" data-testid="rule-rows-loading">
        {RULE_ROWS_TEXT.loading}
      </p>
    );
  }
  const canEdit = editable && view.canEdit;
  const disabled = view.locked;
  const change = (c: RuleChangeIntent) => {
    setError(null);
    set({ campaignId, change: c as RuleChange }).catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <div className="cfg-rs" data-testid="rule-rows" data-readonly={canEdit ? undefined : "true"}>
      <p className="cfg-hint">{canEdit ? RULE_ROWS_TEXT.intro : RULE_ROWS_TEXT.playerIntro}</p>
      {canEdit && view.locked ? (
        <p className="cfg-rs-lock" data-testid="rules-locked">
          <Lock size={16} aria-hidden="true" />
          {RULE_ROWS_TEXT.locked}
        </p>
      ) : null}
      {ruleGroups(frameId).map((group) => {
        const changed = group.rules.filter((r) => isChanged(r, view.modes)).length;
        return (
          <details key={group.area} className="cfg-rs-grp" open={group.area === "optional" ? true : undefined}>
            <summary>
              <span className="cfg-rs-grp-t">{group.label}</span>
              <span className="cfg-muted">
                {group.rules.length} {group.rules.length === 1 ? "rule" : "rules"}
                {changed > 0 ? ` · ${changed} changed` : ""}
              </span>
            </summary>
            <ul className="cfg-rules-list" aria-label={group.label}>
              {group.rules.map((rule) => (
                <RuleRow key={rule.id} rule={rule} modes={view.modes} canEdit={canEdit} disabled={disabled} onChange={change} />
              ))}
            </ul>
          </details>
        );
      })}
      <p aria-live="polite" className="cfg-muted cfg-rules-err">
        {error}
      </p>
    </div>
  );
}

type RowProps = { rule: RuleDef; modes: RuleModes; canEdit: boolean; disabled: boolean; onChange: (c: RuleChangeIntent) => void };

function RuleRow({ rule, modes, canEdit, disabled, onChange }: RowProps) {
  const titleId = useId();
  const head = (
    <div className="cfg-row-t">
      <b id={titleId}>{rule.title}</b>
      <span>{rule.does}</span>
      <em>{ruleTag(rule)}</em>
    </div>
  );
  if (rule.kind === "bookOnly") {
    return (
      <li className="cfg-row cfg-rs-row" data-rule={rule.id} data-kind="book">
        {head}
      </li>
    );
  }
  const reason = canEdit ? readOnlyReason(rule, modes) : null;
  const param = shownParam(rule, modes);
  const value = (modes as unknown as Record<string, string | boolean>)[rule.id];
  const changed = isChanged(rule, modes);

  if (!canEdit || reason !== null) {
    return (
      <li className="cfg-row cfg-col cfg-rs-row" data-rule={rule.id} data-kind={rule.kind}>
        {head}
        <p className="cfg-rs-now">
          <span className={changed ? "cfg-rs-mode cfg-rs-changed" : "cfg-rs-mode"}>{modeText(rule, modes)}</span>
          {modeNotInBooks(rule, modes) ? <small className="cfg-rs-nib">{RULE_ROWS_TEXT.notInBooks}</small> : null}
          {param ? (
            <span className="cfg-muted">
              {param.label} {param.value}
            </span>
          ) : null}
          {reason ? <span className="cfg-muted">{reason}</span> : null}
        </p>
      </li>
    );
  }

  return (
    <li className={isToggleRule(rule) ? "cfg-row cfg-rs-row" : "cfg-row cfg-col cfg-rs-row"} data-rule={rule.id} data-kind={rule.kind}>
      {head}
      {isToggleRule(rule) ? (
        <button
          type="button"
          role="switch"
          aria-checked={value === true}
          aria-labelledby={titleId}
          className="cfg-sw"
          disabled={disabled}
          onClick={() => onChange({ key: rule.id, value: value !== true })}
        >
          <i />
        </button>
      ) : (
        <ModePicker
          name={rule.id}
          labelledBy={titleId}
          options={isSwitchRule(rule) ? rule.modes : isChoiceRule(rule) ? rule.choices : []}
          value={String(value)}
          disabled={disabled}
          onPick={(id) => onChange({ key: rule.id, value: id })}
        />
      )}
      {param ? (
        <Stepper
          label={param.label}
          value={param.value}
          min={param.min}
          max={param.max}
          disabled={disabled}
          onStep={(n) => onChange({ key: param.key, value: n })}
        />
      ) : null}
    </li>
  );
}

/** A radio group styled as the Table section's segmented control; a mode the books don't print is tagged. */
function ModePicker({
  name,
  labelledBy,
  options,
  value,
  disabled,
  onPick,
}: {
  name: string;
  labelledBy: string;
  options: readonly ModeDef[];
  value: string;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const groupName = `${useId()}-${name}`;
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-disabled={disabled || undefined} className="cfg-seg cfg-rs-seg">
      {options.map((m) => (
        <label key={m.id} className="cfg-rs-opt" data-checked={m.id === value ? "true" : undefined}>
          <input
            type="radio"
            name={groupName}
            value={m.id}
            checked={m.id === value}
            disabled={disabled}
            onChange={() => {
              if (m.id !== value) onPick(m.id);
            }}
          />
          <span>{m.label}</span>
          {m.notInBooks ? " " : null}
          {m.notInBooks ? <small className="cfg-rs-nib">{RULE_ROWS_TEXT.notInBooks}</small> : null}
        </label>
      ))}
    </div>
  );
}

/** The number in a rule's row (Tokens per PC 1–6, Difficulty raised by ≥ 1): − and + glass buttons, one step per click. */
function Stepper({
  label,
  value,
  min,
  max,
  disabled,
  onStep,
}: {
  label: string;
  value: number;
  min: number;
  max: number | undefined;
  disabled: boolean;
  onStep: (next: number) => void;
}) {
  const labelId = useId();
  return (
    <div className="cfg-rs-step" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="cfg-muted">
        {label}
      </span>
      <button
        type="button"
        className={glassButtonClass({ role: "neutral", size: "sm", icon: true })}
        aria-label={`${label}: ${RULE_ROWS_TEXT.less}`}
        disabled={disabled || value <= min}
        onClick={() => onStep(value - 1)}
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <output aria-live="polite" className="cfg-rs-num">
        {value}
      </output>
      <button
        type="button"
        className={glassButtonClass({ role: "neutral", size: "sm", icon: true })}
        aria-label={`${label}: ${RULE_ROWS_TEXT.more}`}
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => onStep(value + 1)}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
