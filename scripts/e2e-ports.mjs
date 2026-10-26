// Port settings for the e2e run, and a check that refuses to start when a
// port is already taken (usually a stale server from an earlier run).
//
//   E2E_PORT          Next.js e2e server            (default 3000)
//   E2E_CONVEX_PORT   local Convex backend; its HTTP-actions (site) proxy
//                     listens on E2E_CONVEX_PORT + 1 (default 3212)
//
//   node scripts/e2e-ports.mjs check next convex   # exits 1 with a message
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { pathToFileURL } from "node:url";

function portFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a TCP port number; got "${raw}".`);
  }
  return port;
}

export function e2ePorts() {
  const next = portFromEnv("E2E_PORT", 3000);
  const convex = portFromEnv("E2E_CONVEX_PORT", 3212);
  return { next, convex, convexSite: convex + 1 };
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

export async function isPortBusy(port) {
  return !(await canListen(port)) || (await canConnect(port));
}

function tryRun(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    // lsof exits 1 with output when some lookups fail; keep what it printed.
    return typeof error?.stdout === "string" ? error.stdout : "";
  }
}

/** PIDs listening on the port, best effort (lsof, then ss, then fuser). */
export function listeningPids(port) {
  const lsof = tryRun("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  let pids = lsof.split(/\s+/).filter(Boolean);
  if (pids.length === 0) {
    const ss = tryRun("ss", ["-ltnpH", `sport = :${port}`]);
    pids = [...ss.matchAll(/pid=(\d+)/g)].map((match) => match[1]);
  }
  if (pids.length === 0) {
    pids = tryRun("fuser", [`${port}/tcp`]).split(/\s+/).filter(Boolean);
  }
  return [...new Set(pids)];
}

function commandLine(pid) {
  const proc = `/proc/${pid}/cmdline`;
  if (existsSync(proc)) {
    const cmd = readFileSync(proc, "utf8").split("\0").filter(Boolean).join(" ");
    if (cmd) return cmd;
  }
  return tryRun("ps", ["-o", "command=", "-p", pid]).trim() || "unknown command";
}

const LABELS = {
  next: "Next.js e2e server (E2E_PORT)",
  convex: "local Convex backend (E2E_CONVEX_PORT)",
  convexSite: "local Convex site proxy (E2E_CONVEX_PORT + 1)",
};

/** Returns an error message naming every busy port, or null when all are free. */
export async function describeBusyPorts(names) {
  const ports = e2ePorts();
  const problems = [];
  for (const name of names) {
    const port = ports[name];
    if (!(await isPortBusy(port))) continue;
    const pids = listeningPids(port);
    const owners =
      pids.length > 0
        ? pids.map((pid) => `    PID ${pid}: ${commandLine(pid).slice(0, 200)}`).join("\n")
        : "    (owner PID not visible; try `lsof -nP -iTCP:" + port + " -sTCP:LISTEN`)";
    problems.push(`  port ${port}, ${LABELS[name]}, is already in use:\n${owners}`);
  }
  if (problems.length === 0) return null;
  const pids = problems.join("\n").match(/PID (\d+)/g)?.map((p) => p.slice(4)) ?? [];
  return [
    "E2E ports are taken, most likely by a stale server from an earlier run:",
    ...problems,
    "Then either:",
    pids.length > 0
      ? `  - stop it: kill ${[...new Set(pids)].join(" ")}`
      : "  - stop the process holding the port",
    "  - run on other ports: E2E_PORT=3100 E2E_CONVEX_PORT=3312 pnpm test:e2e",
    "  - reuse running servers on purpose: E2E_REUSE_SERVERS=1 pnpm test:e2e",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [command, ...names] = process.argv.slice(2);
  if (command !== "check" || names.some((name) => !(name in LABELS))) {
    console.error(`usage: node scripts/e2e-ports.mjs check <${Object.keys(LABELS).join("|")}>...`);
    process.exit(2);
  }
  const message = await describeBusyPorts(names);
  if (message) {
    console.error(message);
    process.exit(1);
  }
}
