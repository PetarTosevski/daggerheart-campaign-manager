import type { CountdownCategory } from "@/lib/domain/countdowns";

export const CATEGORY_LABEL: Record<CountdownCategory, string> = {
  threat: "Threat",
  project: "Project",
  consequence: "Consequence",
  other: "Other",
};

