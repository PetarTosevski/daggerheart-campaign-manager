// Prepares a tracer worktree (docs/workflow.md, "Worktrees"):
//   1. copies the git-ignored .env.local and .env.e2e.local from the main
//      checkout (found via `git rev-parse --git-common-dir`); existing files
//      in the worktree are kept
//   2. runs `pnpm install --frozen-lockfile` (cheap: shared pnpm store)
//   3. prints free e2e ports to use for this worktree
//
//   node scripts/worktree-setup.mjs [worktreePath=cwd]
//
// Port checks reuse `isPortBusy` from scripts/e2e-ports.mjs (worktree first,
// then main checkout) when that module exists; otherwise a plain listen test.
// The Next.js port search starts at 3100, the Convex one at 3312 (its site
// proxy needs the next port too), away from the main checkout's defaults
// (3000 and 3212).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ENV_FILES = [".env.local", ".env.e2e.local"];

/** The main checkout's root, given the absolute path git reports as --git-common-dir. */
export function mainCheckoutFromCommonDir(commonDir) {
  return path.dirname(path.resolve(commonDir));
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function loadIsPortBusy(roots) {
  for (const root of roots) {
    const file = path.join(root, "scripts", "e2e-ports.mjs");
    if (!existsSync(file)) continue;
    const ports = await import(pathToFileURL(file).href);
    if (typeof ports.isPortBusy === "function") return ports.isPortBusy;
  }
  return async (port) => !(await canListen(port));
}

/** First port >= start for which `span` consecutive ports are free. */
export async function findFreePort(start, isPortBusy, span = 1, limit = 200) {
  for (let port = start; port < start + limit; port++) {
    let free = true;
    for (let offset = 0; offset < span && free; offset++) free = !(await isPortBusy(port + offset));
    if (free) return port;
  }
  throw new Error(`no free port in ${start}-${start + limit - 1}`);
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const worktree = git(path.resolve(process.argv[2] ?? "."), ["rev-parse", "--show-toplevel"]);
    const commonDir = git(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const main = mainCheckoutFromCommonDir(commonDir);

    if (path.resolve(main) === path.resolve(worktree)) {
      console.warn(`worktree-setup: ${worktree} is the main checkout; skipping env copy`);
    } else {
      for (const name of ENV_FILES) {
        const from = path.join(main, name);
        const to = path.join(worktree, name);
        if (existsSync(to)) console.log(`worktree-setup: kept existing ${name}`);
        else if (!existsSync(from)) console.warn(`worktree-setup: ${main} has no ${name}; skipped`);
        else {
          copyFileSync(from, to);
          console.log(`worktree-setup: copied ${name} from ${main}`);
        }
      }
    }

    console.log("worktree-setup: pnpm install --frozen-lockfile");
    execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: worktree, stdio: "inherit" });

    const isPortBusy = await loadIsPortBusy([worktree, main]);
    const next = await findFreePort(3100, isPortBusy);
    let convex = await findFreePort(3312, isPortBusy, 2);
    if (convex <= next && next <= convex + 1) convex = await findFreePort(next + 1, isPortBusy, 2);
    console.log("worktree-setup: done. Free e2e ports right now; run e2e in this worktree with:");
    console.log(`  E2E_PORT=${next} E2E_CONVEX_PORT=${convex} pnpm test:e2e`);
  } catch (error) {
    console.error(`worktree-setup: ${error.stderr?.toString().trim() || error.message}`);
    process.exit(1);
  }
}
