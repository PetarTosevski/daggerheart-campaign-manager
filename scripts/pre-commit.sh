#!/usr/bin/env sh
# Pre-commit quality gate: ESLint on the staged JS/TS files, then the project
# typecheck. Non-interactive; never runs e2e or tests.
# Called from .beads/hooks/pre-commit (core.hooksPath, set by `pnpm install`).
#
# The website and the Expo app (apps/mobile) lint with their own configs, so
# staged files under apps/mobile/ go to the app's ESLint. The app's typecheck
# (`pnpm typecheck:mobile`) runs only when a staged file can affect it: the
# app itself, the shared code it imports (src/lib, src/components, convex) or
# the dependencies.
#
# Skip once: git commit --no-verify   (or SKIP_PRE_COMMIT=1 git commit ...)
set -eu

if [ "${SKIP_PRE_COMMIT:-}" = "1" ]; then
  exit 0
fi

cd "$(git rev-parse --show-toplevel)"

if [ ! -x node_modules/.bin/eslint ] || [ ! -x node_modules/.bin/tsc ]; then
  echo "pre-commit: dependencies missing; run \`pnpm install\` (skipping checks)." >&2
  exit 0
fi

# Staged JS/TS files, one per line.
staged=$(git diff --cached --name-only --diff-filter=ACMR -- \
  '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs')
web=$(printf '%s\n' "$staged" | grep -v '^apps/mobile/' | grep . || true)
mobile=$(printf '%s\n' "$staged" | grep '^apps/mobile/' || true)

if [ -n "$web" ]; then
  echo "pre-commit: eslint ($(printf '%s\n' "$web" | wc -l | tr -d ' ') staged web file(s))" >&2
  # Checks the working-tree copy of each staged file.
  printf '%s\n' "$web" | tr '\n' '\0' |
    xargs -0 node_modules/.bin/eslint --no-warn-ignored --
fi

if [ -n "$mobile" ]; then
  if [ -x apps/mobile/node_modules/.bin/eslint ]; then
    echo "pre-commit: eslint ($(printf '%s\n' "$mobile" | wc -l | tr -d ' ') staged apps/mobile file(s))" >&2
    # From apps/mobile, so ESLint uses the app's config.
    printf '%s\n' "$mobile" | sed 's#^apps/mobile/##' | tr '\n' '\0' |
      (cd apps/mobile && xargs -0 node_modules/.bin/eslint --no-warn-ignored --)
  else
    echo "pre-commit: apps/mobile dependencies missing; run \`pnpm install\` (skipping its lint)." >&2
  fi
fi

echo "pre-commit: typecheck (web)" >&2
node_modules/.bin/tsc --noEmit

if git diff --cached --quiet -- apps/mobile src/lib src/components convex \
  package.json pnpm-lock.yaml; then
  exit 0
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pre-commit: pnpm not on PATH (skipping the apps/mobile typecheck)." >&2
  exit 0
fi
echo "pre-commit: typecheck (apps/mobile)" >&2
pnpm --silent run typecheck:mobile
