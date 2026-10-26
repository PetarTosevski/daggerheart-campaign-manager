import type { CountdownCategory } from "@/lib/domain/countdowns";

/** The dashboard countdowns' outline button. */
export const BTN =
  "min-h-10 cursor-pointer rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] disabled:cursor-not-allowed disabled:opacity-40";
export const CATEGORY_LABEL: Record<CountdownCategory, string> = {
  threat: "Threat",
  project: "Project",
  consequence: "Consequence",
  other: "Other",
};

