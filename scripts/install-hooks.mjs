// `prepare` script: points git at the tracked hooks in .beads/hooks (beads
// integration plus scripts/pre-commit.sh). No-op outside a git checkout, in CI,
// or when core.hooksPath is already set to something else.
import { execFileSync } from "node:child_process";

const HOOKS_PATH = ".beads/hooks";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

if (!process.env.CI) {
  try {
    git("rev-parse", "--git-dir");
    let current = "";
    try {
      current = git("config", "--get", "core.hooksPath");
    } catch {
      // unset
    }
    if (!current) {
      git("config", "core.hooksPath", HOOKS_PATH);
      console.log(`git hooks: core.hooksPath set to ${HOOKS_PATH}`);
    } else if (current !== HOOKS_PATH && !current.endsWith(`/${HOOKS_PATH}`)) {
      console.log(`git hooks: core.hooksPath is ${current}; leaving it (expected ${HOOKS_PATH}).`);
    }
  } catch {
    // Not a git checkout (e.g. a deployment build): nothing to install.
  }
}
