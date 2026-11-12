"use client";

import Image from "next/image";
import { useId, type CSSProperties, type ReactNode } from "react";

import { designAsset } from "@/lib/design-assets";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../../../convex/_generated/api";
import type { TokenPortrait } from "../../../../../convex/lib/pcPortrait";
import { framedImageStyle } from "../token/model";
import { Pips, Seal } from "../ui";
import { ArmorIcon, ConditionIcon, HeartIcon, StressIcon } from "./icons";

/** One row of `combatHud.party` (HD1). */
export type HudPartyMember = FunctionReturnType<typeof api.combatHud.party>[number];

/**
 * One party banner (plan combat-hud H1.1; HANDOFF "Banners"; CmpTokens 'Banners', Main's row): a real `<button>` that
 * opens the character's sheet, hanging from the gold rod. Portrait, name, class (+ the spotlight slot), HP / Stress /
 * Armor pips, conditions, and the Hope seal at the tip. HP pips show HP left (answer 2) and Armor pips the slots left
 * (the boards' "Armor 2 → 1"); every number the banner announces reads as marked ("2 of 6 Hit Points marked").
 */

/** "2 of 6 Hit Points marked" (answer 2: the text says HP marked, though the pips show HP left). */
export function hpText(member: Pick<HudPartyMember, "hp">): string {
  return `${member.hp.marked} of ${member.hp.max} Hit Points marked`;
}
export function stressText(member: Pick<HudPartyMember, "stress">): string {
  return `${member.stress.marked} of ${member.stress.max} Stress marked`;
}
export function armorText(member: Pick<HudPartyMember, "armor">): string {
  return `${member.armor.marked} of ${member.armor.max} Armor Slots marked`;
}
export function hopeText(member: Pick<HudPartyMember, "hope">): string {
  return `Hope ${member.hope.value} of ${member.hope.max}`;
}

/**
 * What the banner says to a screen reader beyond its name (its description): "Moss, 2 of 6 Hit Points marked, 3 of 6
 * Stress marked, 1 of 3 Armor Slots marked, Hope 1 of 6, Hidden".
 */
export function bannerSummary(member: HudPartyMember): string {
  const parts = [member.name, hpText(member), stressText(member), armorText(member), hopeText(member)];
  for (const condition of member.conditions) parts.push(condition.label);
  if (member.deathMoveDue) parts.push("death move due");
  else if (member.down) parts.push("every Hit Point marked");
  return parts.join(", ");
}

/** The banner's accessible name (hard rule 4; acceptance: "Open <name>'s sheet"). */
export function bannerLabel(member: Pick<HudPartyMember, "name">): string {
  return `Open ${member.name}'s sheet`;
}

/**
 * The portrait in its ring (`.face`): the uploaded image or design art through next/image (CL10), else the initial.
 * The sheet panel (H2.1) shows it too, at 60 px (`className` sizes it there, `sizes` tells next/image). A saved close-up
 * (`portrait.frame`, plan portrait-frame PZ2) scales only the picture; the ring (`overflow: hidden`) clips it.
 */
export function Portrait({
  member,
  className,
  sizes = "58px",
}: {
  member: Pick<HudPartyMember, "mine" | "name"> & { portrait: TokenPortrait };
  className?: string;
  sizes?: string;
}) {
  const p = member.portrait;
  const src = p?.kind === "url" ? p.url : p?.kind === "asset" ? designAsset(p.asset) : undefined;
  return (
    <span className={cn("hbn-face", member.mine && "hbn-face-you", className)} aria-hidden="true">
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes}
          // Uploads are served by Convex storage (another host); design art is local and optimised.
          unoptimized={p?.kind === "url"}
          style={{ objectFit: "cover", ...framedImageStyle(p?.frame, p?.kind === "asset" ? p.position : "center 25%") }}
        />
      ) : (
        <span className="hbn-initial">{member.name.charAt(0).toUpperCase() || "?"}</span>
      )}
    </span>
  );
}

export type BannerProps = {
  member: HudPartyMember;
  /** Place on the rod (0 = x 24). */
  index: number;
  /** This character's sheet is the one open: the banner drops 8 px and its trim lights. */
  open: boolean;
  onOpen: () => void;
  /** After the class: the spotlight tag (H1.S's slot; nothing until it lands). */
  spotlight?: ReactNode;
};

export function Banner({ member, index, open, onOpen, spotlight }: BannerProps) {
  const describedBy = useId();
  return (
    <button
      type="button"
      className={cn("hbn", member.mine && "hbn-you", open && "hbn-open", member.down && "hbn-down")}
      // Hung every 158 px from x = 24 (Main: 24, 182, 340, 498; banners.css).
      style={{ "--hbn-i": index } as CSSProperties}
      aria-label={bannerLabel(member)}
      aria-describedby={describedBy}
      data-testid={`hud-banner-${member.characterId}`}
      data-open={open ? "true" : undefined}
      onClick={onOpen}
    >
      <span className="hbn-in">
        <Portrait member={member} />
        <b className="hbn-name">{member.name}</b>
        <span className="hbn-c">
          {member.className}
          {spotlight}
        </span>
        <span className="hbn-rows">
          <HeartIcon />
          <Pips kind="hp" on={member.hp.max - member.hp.marked} max={member.hp.max} label={hpText(member)} />
          <StressIcon />
          <Pips kind="stress" on={member.stress.marked} max={member.stress.max} label={stressText(member)} />
          {member.armor.max > 0 ? (
            <>
              <ArmorIcon />
              <Pips kind="armor" on={member.armor.max - member.armor.marked} max={member.armor.max} label={armorText(member)} />
            </>
          ) : null}
        </span>
        {member.conditions.length > 0 ? (
          <span className="hbn-cds">
            {member.conditions.map((c) => (
              <span key={c.id} className="hbn-cd">
                <ConditionIcon id={c.id} />
                {c.label}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <Seal className="hbn-seal" value={member.hope.value} label={hopeText(member)} />
      <span id={describedBy} className="sr-only">
        {bannerSummary(member)}
      </span>
    </button>
  );
}
