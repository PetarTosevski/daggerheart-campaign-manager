import { z } from "zod";

import {
  CUSTOM_BACKGROUNDS,
  CUSTOM_TONES,
  FRAME_IDS,
  type FrameId,
} from "../frames/index";

export const CAMPAIGN_NAME_MAX = 80;
export const CUSTOM_TEXT_MAX = 2000;

/** Starting tiers offered by the custom frame form, with the level each starts at. */
export const STARTING_TIERS = [
  { tier: 1, level: 1 },
  { tier: 2, level: 2 },
  { tier: 3, level: 5 },
  { tier: 4, level: 8 },
] as const;

export const PARTY_SIZES = [3, 4, 5, 6] as const;

export const ACCENTS = [
  { value: "#e3b45a", label: "Gold" },
  { value: "#8f78d8", label: "Violet" },
  { value: "#d9775b", label: "Ember" },
  { value: "#6fb8a6", label: "Verdant" },
] as const;

export type Accent = (typeof ACCENTS)[number]["value"];
export const DEFAULT_ACCENT: Accent = "#e3b45a";

export const campaignNameSchema = z
  .string()
  .trim()
  .min(1, "Name your campaign.")
  .max(CAMPAIGN_NAME_MAX, `Keep the name under ${CAMPAIGN_NAME_MAX} characters.`);

/** Case- and whitespace-insensitive key that makes names unique per GM. */
export function campaignNameKey(name: string): string {
  return name.trim().toLowerCase();
}

const optionalText = z.string().trim().max(CUSTOM_TEXT_MAX);

export const customFrameSchema = z.object({
  pitch: optionalText,
  tones: z.array(z.enum(CUSTOM_TONES)).max(CUSTOM_TONES.length),
  themes: optionalText,
  touchstones: optionalText,
  partySize: z.union(PARTY_SIZES.map((n) => z.literal(n))),
  startingTier: z.union(STARTING_TIERS.map((t) => z.literal(t.tier))),
  background: z.enum(
    CUSTOM_BACKGROUNDS.map((b) => b.id) as [string, ...string[]],
  ),
});

export type CustomFrameInput = z.infer<typeof customFrameSchema>;

export const createCampaignSchema = z
  .object({
    frameId: z.enum(FRAME_IDS as [FrameId, ...FrameId[]]),
    name: campaignNameSchema,
    custom: customFrameSchema.optional(),
  })
  .refine((input) => (input.frameId === "custom") === (input.custom !== undefined), {
    message: "Custom details are required for, and only for, a custom campaign.",
    path: ["custom"],
  });

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const settingsSchema = z.object({
  tableName: z.string().trim().max(CAMPAIGN_NAME_MAX),
  gmName: z.string().trim().max(CAMPAIGN_NAME_MAX),
  accent: z.enum(ACCENTS.map((a) => a.value) as [Accent, ...Accent[]]),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

export function startingLevel(tier: number): number {
  return STARTING_TIERS.find((t) => t.tier === tier)?.level ?? 1;
}
