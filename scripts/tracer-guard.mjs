// Checks a tracer branch against its plan entry before merging
// (docs/workflow.md, "Merging"): every file changed since the branch left the
// base must match one of the tracer's `owns` globs, and no file under
// convex/_generated/** may be changed.
//
//   node scripts/tracer-guard.mjs <plan.yaml> <tracerId> [baseRef=rebuild] [headRef=HEAD]
//
// Changed files = `git diff --name-only --no-renames $(git merge-base base head) head`
// (renames count as a deletion plus an addition, so both paths must be owned).
// Plan parsing and glob semantics come from scripts/plan-check.mjs.
//
// Exit 0: clean. Exit 1: violations or errors. Exit 2: usage.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { loadPlan, matchGlob, planTracers } from "./plan-check.mjs";

export const GENERATED_GLOB = "convex/_generated/**";

/** Splits changed files into those outside `owns` and those under convex/_generated. */
export function checkChangedFiles(owns, files) {
  const outside = files.filter((file) => !owns.some((glob) => matchGlob(glob, file)));
  const generated = files.filter((file) => matchGlob(GENERATED_GLOB, file));
  return { outside, generated };
}

/** The tracer entry with this id, or null. */
export function findTracer(plan, id) {
  return planTracers(plan).find(({ tracer }) => tracer.id === id)?.tracer ?? null;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function changedFiles(baseRef, headRef) {
  const base = git(["merge-base", baseRef, headRef]);
  const output = git(["diff", "--name-only", "--no-renames", base, headRef]);
  return output === "" ? [] : output.split("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [planFile, tracerId, baseRef = "rebuild", headRef = "HEAD"] = process.argv.slice(2);
  if (!planFile || !tracerId) {
    console.error("usage: node scripts/tracer-guard.mjs <plan.yaml> <tracerId> [baseRef=rebuild] [headRef=HEAD]");
    process.exit(2);
  }
  try {
    const tracer = findTracer(loadPlan(planFile), tracerId);
    if (!tracer) throw new Error(`${planFile} has no tracer "${tracerId}"`);
    if (!Array.isArray(tracer.owns) || tracer.owns.length === 0) throw new Error(`${tracerId} has no \`owns\` list`);
    const files = changedFiles(baseRef, headRef);
    const { outside, generated } = checkChangedFiles(tracer.owns, files);
    if (outside.length === 0 && generated.length === 0) {
      console.log(`tracer-guard: ${tracerId} OK (${files.length} changed file(s) between ${baseRef} and ${headRef}, all owned)`);
    } else {
      if (outside.length > 0) {
        console.error(`tracer-guard: ${tracerId} changed ${outside.length} file(s) outside its \`owns\` list:`);
        for (const file of outside) console.error(`  - ${file}`);
      }
      if (generated.length > 0) {
        console.error(`tracer-guard: ${tracerId} changed generated Convex code (never commit ${GENERATED_GLOB} from a worktree):`);
        for (const file of generated) console.error(`  - ${file}`);
      }
      process.exit(1);
    }
  } catch (error) {
    console.error(`tracer-guard: ${error.stderr?.toString().trim() || error.message}`);
    process.exit(1);
  }
}
