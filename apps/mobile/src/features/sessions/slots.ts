import type { Id } from "../../convex";

/** The three stages of a session (B2), in tab order. */
export type SessionStage = "prep" | "play" | "wrap";

export const SESSION_STAGES: readonly { id: SessionStage; label: string }[] = [
  { id: "prep", label: "Prep" },
  { id: "play", label: "Play" },
  { id: "wrap", label: "Wrap-up" },
];

export function parseStage(value: string | null | undefined): SessionStage {
  return SESSION_STAGES.some((stage) => stage.id === value) ? (value as SessionStage) : "prep";
}

export type SessionsPageProps = {
  campaignId: Id<"campaigns">;
  isGm: boolean;
};

export type SessionSlotProps = SessionsPageProps & {
  sessionId: Id<"sessions">;
  stage: SessionStage;
  onStage: (stage: SessionStage) => void;
};
