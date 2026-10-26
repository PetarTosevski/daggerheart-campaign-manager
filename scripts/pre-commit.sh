#!/usr/bin/env sh
# Pre-commit quality gate: ESLint on the staged JS/TS files, then the project
# typecheck. Non-interactive and quick (a few seconds); never runs e2e.
# Called from .beads/hooks/pre-commit (core.hooksPath, set by `pnpm install`).
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

staged=$(git diff --cached --name-only --diff-filter=ACMR -- \
  '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' | wc -l)
if [ "$staged" -gt 0 ]; then
  echo "pre-commit: eslint ($staged staged file(s))" >&2
  # Checks the working-tree copy of each staged file.
  git diff --cached --name-only --diff-filter=ACMR -z -- \
    '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' |
    xargs -0 node_modules/.bin/eslint --no-warn-ignored --
fi

echo "pre-commit: typecheck" >&2
node_modules/.bin/tsc --noEmit
