// Prepares a tracer worktree (docs/workflow.md, "Worktrees"):
//   1. copies the git-ignored .env.local and .env.e2e.local from the main
//      checkout (found via `git rev-parse --git-common-dir`); existing files
//      in the worktree are kept
//   2. runs `pnpm install --frozen-lockfile` (cheap: shared pnpm store)
//   3. prints free e2e ports to use for this worktree
//
//   node scripts/worktree-setup.mjs [worktreePath=cwd]
//
// Ports are derived from the worktree's path (a hash picks one of `SLOTS`
// slots), so worktrees set up side by side get different ports instead of all
// landing on the first free one before any server has started. Next.js uses
// 3100-3199 and Convex 3312-3511 in steps of 2 (its site proxy needs the next
// port too), both away from the main checkout's defaults (3000 and 3212). The
// derived port is then checked: when it is busy the search moves on to the
// next slot, wrapping around its range. Port checks reuse `isPortBusy` from
// scripts/e2e-ports.mjs (worktree first, then main checkout) when that module
// exists; otherwise a plain listen test.
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

/** Port slots per range: Next.js `NEXT_BASE + slot`, Convex `CONVEX_BASE + 2 * slot`. */
export const SLOTS = 100;
export const NEXT_BASE = 3100;
export const CONVEX_BASE = 3312;

/** The worktree's slot in 0..SLOTS-1: FNV-1a of its absolute path, so the same worktree always gets the same ports. */
export function worktreeSlot(worktree) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(path.resolve(worktree))) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash % SLOTS;
}

/**
 * The first free port of `base + step * slot` (with `span` consecutive ports
 * free), trying `startSlot` first and then the following slots, wrapping
 * around the range.
 */
export async function findFreeSlotPort(base, step, startSlot, isPortBusy, span = 1) {
  for (let i = 0; i < SLOTS; i++) {
    const port = base + step * ((startSlot + i) % SLOTS);
    let free = true;
    for (let offset = 0; offset < span && free; offset++) free = !(await isPortBusy(port + offset));
    if (free) return port;
  }
  throw new Error(`no free port in ${base}-${base + step * SLOTS - 1}`);
}

/** Free e2e ports for the worktree, starting from the ones its path derives. */
export async function suggestPorts(worktree, isPortBusy) {
  const slot = worktreeSlot(worktree);
  return {
    next: await findFreeSlotPort(NEXT_BASE, 1, slot, isPortBusy),
    convex: await findFreeSlotPort(CONVEX_BASE, 2, slot, isPortBusy, 2),
  };
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
    const { next, convex } = await suggestPorts(worktree, isPortBusy);
    console.log("worktree-setup: done. This worktree's e2e ports (free right now); run e2e here with:");
    console.log(`  E2E_PORT=${next} E2E_CONVEX_PORT=${convex} pnpm test:e2e`);
  } catch (error) {
    console.error(`worktree-setup: ${error.stderr?.toString().trim() || error.message}`);
    process.exit(1);
  }
}
