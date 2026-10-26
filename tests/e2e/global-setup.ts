// Refuses to run e2e against anything but the local test backend.
export default function globalSetup() {
  const url = process.env.E2E_CONVEX_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
    throw new Error(
      `E2E needs the local Convex backend; got "${url}". Run \`pnpm e2e:setup\` first.`,
    );
  }
  if (!process.env.E2E_AUTH_SECRET) {
    throw new Error("E2E_AUTH_SECRET is missing. Run `pnpm e2e:setup` first.");
  }
}
