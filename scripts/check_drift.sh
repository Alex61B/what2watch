#!/usr/bin/env bash
# check_drift.sh — Scans for new files in tracked directories not listed in .workflow_plan_files.
#
# Uses git to find only NEW files (untracked or staged-new) so pre-existing files
# in app/, lib/, etc. are never flagged as drift.
#
# Exit 0 = no unplanned new files found.
# Exit 1 = unplanned new files exist (list printed to stdout, one path per line).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLAN_FILES="$PROJECT_ROOT/.workflow_plan_files"

cd "$PROJECT_ROOT"

# Collect files that are NEW to git in tracked directories.
# Does NOT flag pre-existing committed files — only genuinely new ones.
collect_new_files() {
  # Untracked files in tracked directories (never committed)
  git ls-files --others --exclude-standard \
    app lib components types prisma __tests__ 2>/dev/null || true

  # Staged new files (git add'd but not yet committed) in tracked directories
  git diff --name-only --diff-filter=A HEAD 2>/dev/null \
    | grep -E '^(app|lib|components|types|prisma|__tests__)/' || true

  # Root-level tracked files that are new to git (untracked)
  for f in auth.ts package.json package-lock.json tsconfig.json next.config.ts \
            tailwind.config.ts jest.config.ts jest.setup.ts eslint.config.mjs \
            postcss.config.js prisma.config.ts; do
    if [[ -f "$f" ]] && ! git ls-files --error-unmatch "$f" > /dev/null 2>&1; then
      echo "$f"
    fi
  done
}

if [[ ! -f "$PLAN_FILES" ]]; then
  FOUND=$(collect_new_files | sort -u)
  if [[ -n "$FOUND" ]]; then
    echo "$FOUND"
    exit 1
  fi
  exit 0
fi

DRIFT=()
while IFS= read -r filepath; do
  [[ -z "$filepath" ]] && continue
  rel="${filepath#./}"
  if ! grep -qxF "$rel" "$PLAN_FILES" 2>/dev/null; then
    DRIFT+=("$rel")
  fi
done < <(collect_new_files | sort -u)

if [[ ${#DRIFT[@]} -gt 0 ]]; then
  printf '%s\n' "${DRIFT[@]}"
  exit 1
fi

exit 0
