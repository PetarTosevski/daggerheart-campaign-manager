import { expect, test } from "@jest/globals";
import { useMutation, useQuery } from "convex/react";
import { Text } from "react-native";

import { api } from "../../src/convex";
import { fn } from "./convex-functions";
import { convexReturns, fixtureMismatches, mismatches } from "./convex-returns";
import { createFakeConvex } from "./fake-convex";
import { KNOWN_STALE_FIXTURES, KNOWN_STALE_FIXTURES_CAP } from "./known-stale-fixtures";
import { renderAsGm } from "./render";
import { setActiveClient } from "./session";

function FearValue() {
  const value = useQuery(api.campaigns.fear, { campaignId: "c" } as never);
  return <Text>{String(value)}</Text>;
}

test("the export reads a returns validator for the public functions", () => {
  const { returns, failures } = convexReturns();
  expect(failures).toEqual([]);
  expect(returns["campaigns:fear"]).toEqual({ type: "union", value: [{ type: "number" }, { type: "null" }] });
});

test("a query fixture of the wrong type fails the render at once", () => {
  expect(() => createFakeConvex("gm", { queries: { [fn(api.campaigns.fear)]: "4" } })).toThrow(
    'campaigns:fear $: expected number | null, got string',
  );
});

test("a fixture that conforms, null included where the validator allows it, renders", async () => {
  const screen = await renderAsGm(<FearValue />, { queries: { [fn(api.campaigns.fear)]: null } });
  expect(screen.getByText("null")).toBeTruthy();
});

test("a computed fixture or handler result that breaks its validator fails the test when it ends", () => {
  const client = createFakeConvex("gm", {
    queries: { [fn(api.campaigns.fear)]: () => ({ fear: 3 }) },
    mutations: { [fn(api.campaigns.markOpened)]: () => "done" },
  });
  client.queryResult(fn(api.campaigns.fear), {});
  client.call(fn(api.campaigns.markOpened), {}, "mutation");
  expect(client.fixtureErrors).toEqual([
    "Query fixture breaks its returns validator: campaigns:fear $: expected number | null, got object",
    "mutation handler result breaks its returns validator: campaigns:markOpened $: expected null, got string",
  ]);
  // Keep session.ts's afterEach from failing this test on purpose.
  setActiveClient(null);
});

function MarkOpened() {
  const markOpened = useMutation(api.campaigns.markOpened);
  void markOpened({ campaignId: "c" } as never);
  return null;
}

test("a handler that returns nothing is fine (undefined is Convex's null)", async () => {
  const screen = await renderAsGm(<MarkOpened />, { mutations: { [fn(api.campaigns.markOpened)]: () => undefined } });
  expect(screen.client.fixtureErrors).toEqual([]);
});

test("objects report missing and extra fields; arrays and unions name the member the fixture meant", () => {
  const row = {
    type: "object",
    value: {
      id: { fieldType: { type: "id", tableName: "x" }, optional: false },
      note: { fieldType: { type: "string" }, optional: true },
      kind: {
        fieldType: { type: "union", value: [{ type: "literal", value: "a" }, { type: "literal", value: "b" }] },
        optional: false,
      },
    },
  } as const;
  expect(mismatches({ type: "array", value: row }, [{ id: "1", kind: "a" }, { kind: "c", extra: 1 }])).toEqual([
    "$[].id: missing (required)",
    '$[].kind: expected "a" | "b", got string',
    "$[].extra: not in the validator",
  ]);
  expect(mismatches({ type: "union", value: [{ type: "null" }, row] }, { id: "1" })).toEqual([
    "$.kind: missing (required)",
  ]);
  expect(
    mismatches(
      { type: "record", keys: { type: "string" }, values: { fieldType: { type: "number" }, optional: false } },
      { a: 1, b: "2" },
    ),
  ).toEqual(["${}: expected number, got string"]);
});

test("a paginated query's fixture is checked row by row against the page element", () => {
  const name = Object.entries(convexReturns().returns).find(
    ([, validator]) => validator?.type === "object" && "page" in validator.value && "isDone" in validator.value,
  )?.[0];
  expect(name).toBeDefined();
  expect(fixtureMismatches(name!, [42])[0]).toMatch(/^\S+ \$\[\]: expected object, got number 42$/);
  expect(fixtureMismatches(name!, { results: [42], status: "Exhausted" })[0]).toMatch(/\$\[\]: expected object/);
});

test("KNOWN_STALE_FIXTURES only shrinks and names functions that still exist", () => {
  expect(KNOWN_STALE_FIXTURES.length).toBeLessThanOrEqual(KNOWN_STALE_FIXTURES_CAP);
  expect(new Set(KNOWN_STALE_FIXTURES).size).toBe(KNOWN_STALE_FIXTURES.length);
  const { returns } = convexReturns();
  const gone = KNOWN_STALE_FIXTURES.filter((line) => !returns[line.split(" ")[0] ?? ""]);
  expect(gone).toEqual([]);
});
