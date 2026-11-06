import { beforeEach, expect, test } from "@jest/globals";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { LorekeeperChat } from "../../../src/features/lorekeeper/chat";
import { LibraryCard } from "../../../src/features/lorekeeper/library";
import { RulingsCard } from "../../../src/features/lorekeeper/rulings";
import { resetSelectionForTests } from "../../../src/features/lorekeeper/selection";
import type { LorekeeperChatProps, LorekeeperSideProps } from "../../../src/features/lorekeeper/slots";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { campaignId, conversationId, lorekeeperQueries } from "./fixture";

beforeEach(() => {
  resetMotionTest();
  resetSelectionForTests();
});

const playerChat: LorekeeperChatProps = {
  campaignId,
  access: { isGm: false },
  variant: "page",
};

const gmSide: LorekeeperSideProps = {
  campaignId,
  access: { isGm: true },
};

const playerSide: LorekeeperSideProps = {
  campaignId,
  access: { isGm: false },
};

test("a player chat never subscribes to lorekeeperAsks.listOpen", async () => {
  const screen = await renderAsPlayer(<LorekeeperChat {...playerChat} />, {
    queries: lorekeeperQueries("player"),
  });
  expect(screen.getByText("Melee is adjacent.")).toBeTruthy();
  expect(screen.client.subscribed).not.toContain("lorekeeperAsks:listOpen");
  expect(screen.client.subscribed).toContain("lorekeeper:listMessages");
});

test("the GM library card shows About books and rulings subscribe to listOpen", async () => {
  const library = await renderAsGm(<LibraryCard {...gmSide} />, {
    queries: lorekeeperQueries("gm"),
  });
  expect(library.getByText("About books")).toBeTruthy();

  const rulings = await renderAsGm(<RulingsCard {...gmSide} />, {
    queries: lorekeeperQueries("gm"),
  });
  expect(rulings.client.subscribed).toContain("lorekeeperAsks:listOpen");
});

test("a player library card has no About books and rulings skip listOpen", async () => {
  const library = await renderAsPlayer(<LibraryCard {...playerSide} />, {
    queries: lorekeeperQueries("player"),
  });
  expect(library.queryByText("About books")).toBeNull();

  const rulings = await renderAsPlayer(<RulingsCard {...playerSide} />, {
    queries: lorekeeperQueries("player"),
  });
  expect(rulings.client.subscribed).not.toContain("lorekeeperAsks:listOpen");
});

test("a streaming answer renders from listMessages", async () => {
  const streaming = [
    {
      _id: "msg-q2",
      _creationTime: 3,
      conversationId,
      role: "question" as const,
      text: "Fear?",
      status: "done" as const,
      createdAt: 3,
      updatedAt: 3,
    },
    {
      _id: "msg-a2",
      _creationTime: 4,
      conversationId,
      role: "answer" as const,
      text: "Fear is",
      status: "streaming" as const,
      phase: "books" as const,
      createdAt: 4,
      updatedAt: 4,
    },
  ];
  const screen = await renderAsPlayer(<LorekeeperChat {...playerChat} />, {
    queries: lorekeeperQueries("player", { "lorekeeper:listMessages": streaming }),
  });
  expect(screen.getByText("Fear is")).toBeTruthy();
});
