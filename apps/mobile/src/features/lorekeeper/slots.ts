import type { Id } from "../../convex";

export type LorekeeperAccess = {
  isGm: boolean;
};

export type LorekeeperVariant = "page" | "drawer";

export type LorekeeperChatProps = {
  campaignId: Id<"campaigns">;
  access: LorekeeperAccess;
  variant: LorekeeperVariant;
};

export type LorekeeperSideProps = {
  campaignId: Id<"campaigns">;
  access: LorekeeperAccess;
};
