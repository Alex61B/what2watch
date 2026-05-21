#!/usr/bin/env bash
# stop.sh — Runs when Claude finishes a response turn.
#
# Reminds the agent to log prompts in PROMPTS.md and warns on high failure count.
# This hook does not block — it prints reminders to stderr.
# Hard gates are in scripts/advance_state.sh.
#
# Exit 0 always.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_FILE="$PROJECT_ROOT/.workflow_state"
FAILURES_FILE="$PROJECT_ROOT/.workflow_failures"
PROMPTS_FILE="$PROJECT_ROOT/PROMPTS.md"

STATE=$(cat "$STATE_FILE" 2>/dev/null | tr -d '[:space:]' || echo "RESEARCH")
FAILURES=$(cat "$FAILURES_FILE" 2>/dev/null | tr -d '[:space:]' || echo "0")

# Count real prompt entries in the '## Prompt Log' section only.
if [[ -f "$PROMPTS_FILE" ]]; then
  REAL_ENTRIES=$(awk '
    /^## Prompt Log/ { in_log = 1; next }
    in_log && /^### Prompt #[0-9]/ { count++ }
    END { print count + 0 }
  ' "$PROMPTS_FILE" 2>/dev/null || echo "0")

  if [[ "$REAL_ENTRIES" -eq 0 ]]; then
    echo "" >&2
    echo "─────────────────────────────────────────────────" >&2
    echo "REMINDER: No prompts logged in PROMPTS.md yet." >&2
    echo "Every prompt used during development must be logged" >&2
    echo "under the '## Prompt Log' section in PROMPTS.md." >&2
    echo "─────────────────────────────────────────────────" >&2
  fi
fi

# Warn if failure count is elevated
if [[ "$FAILURES" -ge 2 ]]; then
  echo "" >&2
  echo "WARNING: Remediation attempt $FAILURES/3 (state: $STATE)." >&2
  echo "Address only the failing verification check — no new features." >&2
  if [[ "$FAILURES" -ge 3 ]]; then
    echo "STOP: Three repeated failures. Write a blocker summary before retrying." >&2
  fi
fi

exit 0
