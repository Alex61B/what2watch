#!/usr/bin/env bash
# post_tool_use.sh — Post-execution tracking and drift detection.
#
# Receives tool result JSON on stdin (Claude Code hook protocol).
# Exit 0 always (post-use hook non-zero exit generates a warning, not a block).
#
# In IMPLEMENT state, runs check_drift.sh after every Bash command.
# If unplanned files are found, writes .workflow_drift and logs to stderr.
# pre_tool_use.sh will block all subsequent tool calls until drift is resolved.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_FILE="$PROJECT_ROOT/.workflow_state"
ACTIVITY_LOG="$PROJECT_ROOT/.workflow_activity"
DRIFT_FLAG="$PROJECT_ROOT/.workflow_drift"
CHECK_DRIFT="$PROJECT_ROOT/scripts/check_drift.sh"

STATE=$(cat "$STATE_FILE" 2>/dev/null | tr -d '[:space:]' || echo "UNKNOWN")

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_name', ''))
except Exception:
    print('')
" 2>/dev/null || true)

# Log write/mutating tool calls to activity log
case "$TOOL_NAME" in
  Write|Edit|Bash)
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
    echo "$TIMESTAMP [$STATE] $TOOL_NAME" >> "$ACTIVITY_LOG" 2>/dev/null || true
    ;;
esac

# Drift detection: after any Bash command in IMPLEMENT state,
# scan for new application files not listed in .workflow_plan_files.
if [[ "$STATE" == "IMPLEMENT" && "$TOOL_NAME" == "Bash" && -x "$CHECK_DRIFT" ]]; then
  if [[ ! -f "$DRIFT_FLAG" ]]; then
    DRIFT_OUTPUT=$(bash "$CHECK_DRIFT" 2>/dev/null || true)
    if [[ -n "$DRIFT_OUTPUT" ]]; then
      echo "$DRIFT_OUTPUT" > "$DRIFT_FLAG"
      echo "" >&2
      echo "═══════════════════════════════════════════════════════════" >&2
      echo "DRIFT DETECTED: Unplanned files found after Bash command." >&2
      echo "All further tool calls are blocked until drift is resolved." >&2
      echo "" >&2
      echo "Unplanned files:" >&2
      echo "$DRIFT_OUTPUT" | sed 's/^/  /' >&2
      echo "" >&2
      echo "Recovery:" >&2
      echo "  1. Delete unplanned files + rm .workflow_drift  → continue IMPLEMENT" >&2
      echo "  2. bash scripts/advance_state.sh drift-to-plan     → return to PLAN" >&2
      echo "  3. bash scripts/advance_state.sh drift-to-research → return to RESEARCH" >&2
      echo "═══════════════════════════════════════════════════════════" >&2
    fi
  fi
fi

exit 0
