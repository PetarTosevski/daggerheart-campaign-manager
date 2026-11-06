import { expect, test } from "@jest/globals";

import { api } from "../../../src/convex";
import { MarkOpened } from "../../../src/features/account/mark-opened";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";

test("opening a campaign records it once per campaign id", async () => {
  const calls: unknown[] = [];
  const mutations = {
    [fn(api.campaigns.markOpened)]: (args: unknown) => {
      calls.push(args);
      return null;
    },
  };
  const screen = await renderAsPlayer(<MarkOpened campaign={null} />, { mutations });
  expect(calls).toEqual([]);

  await screen.rerender(<MarkOpened campaign={{ _id: "campaign-1", ownerView: false }} />);
  await screen.rerender(<MarkOpened campaign={{ _id: "campaign-1", ownerView: false }} />);
  expect(calls).toEqual([{ campaignId: "campaign-1" }]);

  await screen.rerender(<MarkOpened campaign={{ _id: "campaign-2", ownerView: false }} />);
  expect(calls).toEqual([{ campaignId: "campaign-1" }, { campaignId: "campaign-2" }]);
});

test("the owner's read-only view never records the open, and a failure is ignored", async () => {
  const owner = await renderAsGm(<MarkOpened campaign={{ _id: "campaign-1", ownerView: true }} />);
  expect(owner.client.called).toEqual([]);

  const failing = await renderAsGm(<MarkOpened campaign={{ _id: "campaign-1", ownerView: false }} />, {
    mutations: {
      [fn(api.campaigns.markOpened)]: () => Promise.reject(new Error("offline")),
    },
  });
  expect(failing.client.called).toEqual([fn(api.campaigns.markOpened)]);
  expect(failing.toJSON()).toBeNull();
});
