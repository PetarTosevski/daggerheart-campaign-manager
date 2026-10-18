import { describe, expect, it } from "vitest";

import {
  findCycle,
  globsOverlap,
  matchGlob,
  parseYaml,
  validatePlan,
} from "../../scripts/plan-check.mjs";
import { checkChangedFiles, findTracer } from "../../scripts/tracer-guard.mjs";
import { CONVEX_BASE, findFreeSlotPort, mainCheckoutFromCommonDir, NEXT_BASE, SLOTS, suggestPorts, worktreeSlot } from "../../scripts/worktree-setup.mjs";

type Tracer = {
  id: string;
  goal?: string;
  depends_on?: string[];
  owns?: string[];
  acceptance?: string[];
  foundation?: boolean;
};

function tracer(id: string, owns: string[], extra: Partial<Tracer> = {}): Tracer {
  return { id, goal: `${id} works`, depends_on: [], owns, acceptance: ["tests pass"], ...extra };
}

function plan(...waves: Tracer[][]) {
  return { plan: "test", waves: waves.map((tracers, index) => ({ wave: index + 1, tracers })) };
}

describe("globsOverlap", () => {
  it.each([
    ["a/**", "a/b.ts"],
    ["a/*.ts", "a/x.ts"],
    ["a/**", "a/b/c/d.ts"],
    ["a/**/*.ts", "a/b/c.ts"],
    ["a/**/*.ts", "a/c.ts"],
    ["a/**", "a/b/**"],
    ["**/*.test.ts", "tests/unit/x.test.ts"],
    ["a/*.ts", "a/*.test.ts"],
    ["a/x?.ts", "a/xy.ts"],
    ["src/app/(gm)/campaigns/[campaignId]/**", "src/app/(gm)/campaigns/[campaignId]/page.tsx"],
    ["dir/", "dir/file.ts"],
    ["./a/b.ts", "a/b.ts"],
  ])("%s overlaps %s", (a, b) => {
    expect(globsOverlap(a, b)).toBe(true);
    expect(globsOverlap(b, a)).toBe(true);
  });

  it.each([
    ["a/b.ts", "a/c.ts"],
    ["a/*.ts", "a/b/x.ts"],
    ["a/*.ts", "a/x.tsx"],
    ["a/**", "b/a.ts"],
    ["a/**/*.ts", "a/b/c.js"],
    ["src/app/[campaignId]/page.tsx", "src/app/x/page.tsx"],
    ["a/x?.ts", "a/x.ts"],
  ])("%s does not overlap %s", (a, b) => {
    expect(globsOverlap(a, b)).toBe(false);
    expect(globsOverlap(b, a)).toBe(false);
  });
});

describe("matchGlob", () => {
  it("matches literal paths against globs", () => {
    expect(matchGlob("convex/tables/**", "convex/tables/users.ts")).toBe(true);
    expect(matchGlob("convex/*.ts", "convex/tables/users.ts")).toBe(false);
    expect(matchGlob("convex/schema.ts", "convex/schema.ts")).toBe(true);
    expect(matchGlob("convex/schema.ts", "convex/schema.tsx")).toBe(false);
  });

  it("treats glob characters in the path as literal", () => {
    expect(matchGlob("a/x.ts", "a/*.ts")).toBe(false);
  });
});

describe("parseYaml", () => {
  it("parses the plan format", () => {
    const source = [
      "plan: demo # trailing comment",
      "waves:",
      "  - wave: 1",
      "    tracers:",
      "      - id: T1",
      "        goal: One sentence: what works end to end.",
      "        depends_on: []",
      "        owns:",
      "          - src/app/(gm)/campaigns/[campaignId]/**",
      "          - 'quoted: path'",
      "        acceptance:",
      '          - "pnpm test # passes"',
      "      - id: T2",
      "        depends_on: [T1, T0]",
      "        owns:",
      "        - a.ts",
    ].join("\n");
    expect(parseYaml(source)).toEqual({
      plan: "demo",
      waves: [
        {
          wave: 1,
          tracers: [
            {
              id: "T1",
              goal: "One sentence: what works end to end.",
              depends_on: [],
              owns: ["src/app/(gm)/campaigns/[campaignId]/**", "quoted: path"],
              acceptance: ["pnpm test # passes"],
            },
            { id: "T2", depends_on: ["T1", "T0"], owns: ["a.ts"] },
          ],
        },
      ],
    });
  });

  it("rejects tabs and unsupported syntax", () => {
    expect(() => parseYaml("a:\n\t- b")).toThrow(/tabs/);
    expect(() => parseYaml("a: {b: 1}")).toThrow(/flow mappings/);
    expect(() => parseYaml("a: 1\na: 2")).toThrow(/duplicate key/);
  });
});

describe("findCycle", () => {
  it("returns null for an acyclic graph", () => {
    expect(findCycle(new Map([["A", ["B"]], ["B", ["C"]], ["C", []]]))).toBeNull();
  });

  it("returns the cycle path", () => {
    expect(findCycle(new Map([["A", ["B"]], ["B", ["C"]], ["C", ["A"]]]))).toEqual(["A", "B", "C", "A"]);
  });
});

describe("validatePlan", () => {
  it("accepts a valid plan", () => {
    const result = validatePlan(
      plan([tracer("T1", ["a/**"]), tracer("T2", ["b/**"])], [tracer("T3", ["a/**"], { depends_on: ["T1"] })]),
    );
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it("rejects same-wave overlaps, naming both tracers and both globs", () => {
    const { errors } = validatePlan(plan([tracer("T1", ["convex/tables/**"]), tracer("T2", ["convex/tables/users.ts"])]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("T1");
    expect(errors[0]).toContain("T2");
    expect(errors[0]).toContain('"convex/tables/**"');
    expect(errors[0]).toContain('"convex/tables/users.ts"');
  });

  it("allows the same path in different waves", () => {
    expect(validatePlan(plan([tracer("T1", ["a.ts"])], [tracer("T2", ["a.ts"])])).errors).toEqual([]);
  });

  it("rejects duplicate ids and missing fields", () => {
    const { errors } = validatePlan(
      plan([tracer("T1", ["a.ts"]), { id: "T1", owns: [] } as Tracer]),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        "T1: duplicate tracer id",
        "T1: `goal` is required",
        "T1: `owns` must be a non-empty list of paths/globs",
        "T1: `acceptance` must be a non-empty list",
      ]),
    );
  });

  it("rejects unknown, later-wave and self dependencies", () => {
    const { errors } = validatePlan(
      plan(
        [tracer("T1", ["a.ts"], { depends_on: ["T9", "T2", "T1"] })],
        [tracer("T2", ["b.ts"])],
      ),
    );
    expect(errors).toEqual([
      'T1: depends_on "T9", which is not a tracer in this plan',
      'T1: depends_on "T2", which is in a later wave',
      "T1: depends on itself",
    ]);
  });

  it("detects dependency cycles within a wave", () => {
    const { errors } = validatePlan(
      plan([
        tracer("T1", ["a.ts"], { depends_on: ["T2"] }),
        tracer("T2", ["b.ts"], { depends_on: ["T3"] }),
        tracer("T3", ["c.ts"], { depends_on: ["T1"] }),
      ]),
    );
    expect(errors).toEqual(["dependency cycle: T1 -> T2 -> T3 -> T1"]);
  });

  it("warns when a non-foundation tracer owns always-shared files", () => {
    const { errors, warnings } = validatePlan(
      plan([
        tracer("T0", ["package.json"]),
        tracer("T1", ["pnpm-lock.yaml"]),
        tracer("T2", ["convex/**"]),
        tracer("T3", ["x/**"], { foundation: true }),
      ]),
    );
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^T1: owns "pnpm-lock.yaml"/);
    expect(warnings[1]).toMatch(/^T2: owns "convex\/\*\*", which touches always-shared "convex\/_generated\/\*\*"/);
  });
});

describe("tracer guard", () => {
  const owns = ["convex/schema.ts", "convex/tables/**"];

  it("passes when every changed file is owned", () => {
    expect(checkChangedFiles(owns, ["convex/schema.ts", "convex/tables/users.ts"])).toEqual({
      outside: [],
      generated: [],
    });
  });

  it("lists every file outside owns", () => {
    expect(checkChangedFiles(owns, ["convex/schema.ts", "package.json", "src/x.ts"]).outside).toEqual([
      "package.json",
      "src/x.ts",
    ]);
  });

  it("rejects generated Convex code even when owned", () => {
    expect(checkChangedFiles(["convex/**"], ["convex/_generated/api.d.ts"])).toEqual({
      outside: [],
      generated: ["convex/_generated/api.d.ts"],
    });
  });

  it("finds a tracer by id", () => {
    const p = plan([tracer("T1", ["a.ts"])], [tracer("T2", ["b.ts"])]);
    expect(findTracer(p, "T2")?.owns).toEqual(["b.ts"]);
    expect(findTracer(p, "T3")).toBeNull();
  });
});

describe("worktree setup", () => {
  it("derives the main checkout from the common git dir", () => {
    expect(mainCheckoutFromCommonDir("/home/me/repo/.git")).toBe("/home/me/repo");
  });

  it("derives a stable slot per worktree path, different for different worktrees", () => {
    const paths = Array.from({ length: 6 }, (_, i) => `/home/me/repo/.claude/worktrees/agent-${i}`);
    const slots = paths.map(worktreeSlot);
    expect(slots.map((_, i) => worktreeSlot(paths[i]!))).toEqual(slots);
    for (const slot of slots) expect(Number.isInteger(slot) && slot >= 0 && slot < SLOTS).toBe(true);
    expect(new Set(slots).size).toBe(paths.length);
  });

  it("suggests the worktree's derived ports when they are free, distinct per worktree", async () => {
    const none = async () => false;
    const a = await suggestPorts("/home/me/repo/.claude/worktrees/agent-0", none);
    const b = await suggestPorts("/home/me/repo/.claude/worktrees/agent-1", none);
    expect(a).toEqual({ next: NEXT_BASE + worktreeSlot("/home/me/repo/.claude/worktrees/agent-0"), convex: CONVEX_BASE + 2 * worktreeSlot("/home/me/repo/.claude/worktrees/agent-0") });
    expect(a.next).not.toBe(b.next);
    expect(a.convex).not.toBe(b.convex);
    // The ranges never overlap each other or the main checkout's 3000 / 3212-3213.
    expect(NEXT_BASE + SLOTS - 1).toBeLessThan(CONVEX_BASE);
    expect(CONVEX_BASE).toBeGreaterThan(3213);
  });

  it("checks the derived ports and moves past busy ones, wrapping around the range", async () => {
    const worktree = "/home/me/repo/.claude/worktrees/agent-0";
    const slot = worktreeSlot(worktree);
    const busy = new Set([NEXT_BASE + slot, CONVEX_BASE + 2 * slot + 1]);
    const checked: number[] = [];
    const isBusy = async (port: number) => (checked.push(port), busy.has(port));
    expect(await suggestPorts(worktree, isBusy)).toEqual({
      next: NEXT_BASE + ((slot + 1) % SLOTS),
      convex: CONVEX_BASE + 2 * ((slot + 1) % SLOTS),
    });
    expect(checked).toContain(NEXT_BASE + slot);
    expect(checked).toContain(CONVEX_BASE + 2 * slot + 1);

    const last = SLOTS - 1;
    expect(await findFreeSlotPort(NEXT_BASE, 1, last, async (port: number) => port === NEXT_BASE + last)).toBe(NEXT_BASE);
    await expect(findFreeSlotPort(NEXT_BASE, 1, 0, async () => true)).rejects.toThrow("no free port");
  });
});
