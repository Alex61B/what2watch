#!/usr/bin/env bash
# stop.sh — Runs when Claude finishes a response turn.
# Warns when the remediation failure counter is elevated.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_FILE="$PROJECT_ROOT/.workflow_state"
FAILURES_FILE="$PROJECT_ROOT/.workflow_failures"

STATE=$(cat "$STATE_FILE" 2>/dev/null | tr -d '[:space:]' || echo "RESEARCH")
FAILURES=$(cat "$FAILURES_FILE" 2>/dev/null | tr -d '[:space:]' || echo "0")

if [[ "$FAILURES" -ge 2 ]]; then
  echo "" >&2
  echo "WARNING: Remediation attempt $FAILURES/3 (state: $STATE)." >&2
  echo "Address only the failing verification check — no new features." >&2
  if [[ "$FAILURES" -ge 3 ]]; then
    echo "STOP: Three repeated failures. Write a blocker summary before retrying." >&2
  fi
fi

exit 0
