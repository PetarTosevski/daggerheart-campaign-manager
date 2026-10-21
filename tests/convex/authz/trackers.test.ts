import { describe, expect, it } from "vitest";

import { api } from "../../../convex/_generated/api";
import { key } from "../helpers";
import { runMatrix } from "./harness";
import area from "./trackers.entries";
import { allowWorldEmails, buildWorld } from "./world";

runMatrix(area);

/** Frame-exclusive trackers are refused on the server: the GM of a Witherwild campaign gets MECHANIC_DISABLED. */
describe("trackers in a campaign of another frame", () => {
  allowWorldEmails();

  it("refuse the GM with MECHANIC_DISABLED (Five Banners' state reads null)", async () => {
    const w = await buildWorld({ frameId: "witherwild" });
    const gm = w.as("gm");
    const campaignId = w.campaignId;
    const code = (call: Promise<unknown>) =>
      call.then(
        () => "resolved",
        (error: { data?: { code?: string } }) => error.data?.code,
      );
    const keyed = { campaignId, idempotencyKey: key() };

    expect(await code(gm.query(api.trackers.ageOfUmbra.get, { campaignId }))).toBe("MECHANIC_DISABLED");
    expect(await code(gm.mutation(api.trackers.ageOfUmbra.addPyre, { ...keyed, settlement: "Ashford" }))).toBe("MECHANIC_DISABLED");
    expect(await code(gm.query(api.trackers.andaluria.get, { campaignId }))).toBe("MECHANIC_DISABLED");
    expect(await code(gm.mutation(api.trackers.andaluria.createHunt, { ...keyed, title: "The Beast" }))).toBe("MECHANIC_DISABLED");
    expect(await code(gm.query(api.trackers.colossus.get, { campaignId }))).toBe("MECHANIC_DISABLED");
    expect(await code(gm.mutation(api.trackers.colossus.defeatColossus, keyed))).toBe("MECHANIC_DISABLED");
    expect(await gm.query(api.trackers.fiveBanners.state, { campaignId })).toBeNull();
    expect(await code(gm.mutation(api.trackers.fiveBanners.setRelationship, { ...keyed, a: "polaris", b: "hilltop", value: 1 }))).toBe(
      "MECHANIC_DISABLED",
    );
    expect(await code(gm.query(api.trackers.horizon.get, { campaignId }))).toBe("MECHANIC_DISABLED");
    expect(await code(gm.mutation(api.trackers.horizon.setEchoes, { ...keyed, value: 2 }))).toBe("MECHANIC_DISABLED");
    expect(await code(gm.query(api.trackers.weredragon.get, { campaignId }))).toBe("MECHANIC_DISABLED");
    expect(await code(gm.mutation(api.trackers.weredragon.readNightSky, keyed))).toBe("MECHANIC_DISABLED");
    expect(await code(w.as("player").mutation(api.trackers.weredragon.submitSecret, { ...keyed, text: "Forlorne fled" }))).toBe(
      "MECHANIC_DISABLED",
    );
  }, 60_000);
});
