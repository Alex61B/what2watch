#!/usr/bin/env bash
# advance_state.sh — Manages workflow state transitions with deterministic exit gates.
#
# Usage:
#   bash scripts/advance_state.sh next            — advance to the next state
#   bash scripts/advance_state.sh fail            — TEST failed; return to RESEARCH
#   bash scripts/advance_state.sh drift-to-plan   — drift detected; return to PLAN
#   bash scripts/advance_state.sh drift-to-research — drift + wrong assumptions; return to RESEARCH
#
# State machine:
#   RESEARCH ──(docs/research.md + PROMPTS entry)──▶ PLAN
#   PLAN     ──(.workflow_plan_files non-empty)──────▶ IMPLEMENT
#   IMPLEMENT──(all files exist + no drift)──────────▶ TEST
#   TEST     ──(.workflow_verified exists)───────────▶ done (resets to RESEARCH)
#   TEST     ──fail──▶ RESEARCH  (remediation loop; stops at 3 failures)
#   IMPLEMENT──drift-to-plan──▶ PLAN
#   IMPLEMENT──drift-to-research──▶ RESEARCH

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_FILE="$PROJECT_ROOT/.workflow_state"
FAILURES_FILE="$PROJECT_ROOT/.workflow_failures"
VERIFIED_LOCK="$PROJECT_ROOT/.workflow_verified"
DRIFT_FLAG="$PROJECT_ROOT/.workflow_drift"
PLAN_FILES="$PROJECT_ROOT/.workflow_plan_files"
CHECK_DRIFT="$PROJECT_ROOT/scripts/check_drift.sh"

ACTION="${1:-next}"

CURRENT=$(cat "$STATE_FILE" 2>/dev/null | tr -d '[:space:]' || echo "RESEARCH")
FAILURES=$(cat "$FAILURES_FILE" 2>/dev/null | tr -d '[:space:]' || echo "0")

# ─── Gate helpers ─────────────────────────────────────────────────────────────

check_research_gate() {
  local doc="$PROJECT_ROOT/docs/research.md"
  local required_sections=(
    "Requirements Summary"
    "Stack Choices"
    "Environment Verification"
    "Risks & Edge Cases"
    "Assumptions & Open Questions"
    "Out of Scope"
    "READY FOR PLANNING"
  )

  if [[ ! -f "$doc" ]]; then
    echo "ERROR: docs/research.md does not exist." >&2
    echo "" >&2
    echo "  Create docs/research.md with the following sections before advancing:" >&2
    printf '    - %s\n' "${required_sections[@]}" >&2
    echo "" >&2
    echo "  The file must end with a 'Readiness Verdict: READY FOR PLANNING' section." >&2
    exit 1
  fi

  local missing=()
  for section in "${required_sections[@]}"; do
    if ! grep -qi "$section" "$doc" 2>/dev/null; then
      missing+=("$section")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: docs/research.md is missing required sections:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    echo "" >&2
    echo "  All sections must be present before advancing from RESEARCH." >&2
    exit 1
  fi

  echo "  ✓ docs/research.md — all sections present"
}

check_plan_gate() {
  if [[ ! -f "$PLAN_FILES" ]]; then
    echo "ERROR: .workflow_plan_files does not exist." >&2
    echo "  Create it (one planned file path per line) before advancing from PLAN." >&2
    exit 1
  fi

  local count
  count=$(grep -c . "$PLAN_FILES" 2>/dev/null || echo "0")
  if [[ "$count" -eq 0 ]]; then
    echo "ERROR: .workflow_plan_files is empty." >&2
    echo "  Add planned file paths (one per line) before advancing." >&2
    exit 1
  fi

  echo "  ✓ .workflow_plan_files — $count file(s) planned"
}

check_implement_gate() {
  check_plan_gate

  local missing=()
  while IFS= read -r filepath; do
    [[ -z "$filepath" ]] && continue
    if [[ ! -f "$PROJECT_ROOT/$filepath" ]]; then
      missing+=("$filepath")
    fi
  done < "$PLAN_FILES"

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: These planned files have not been implemented:" >&2
    printf '  %s\n' "${missing[@]}" >&2
    echo "" >&2
    echo "  Implement all files in .workflow_plan_files before advancing to TEST." >&2
    exit 1
  fi

  if [[ -x "$CHECK_DRIFT" ]]; then
    DRIFT=$(bash "$CHECK_DRIFT" 2>/dev/null || true)
    if [[ -n "$DRIFT" ]]; then
      echo "ERROR: Unplanned files exist in tracked directories:" >&2
      echo "$DRIFT" | sed 's/^/  /' >&2
      echo "" >&2
      echo "  Resolve drift before advancing to TEST:" >&2
      echo "    bash scripts/advance_state.sh drift-to-plan     (add to plan)" >&2
      echo "    bash scripts/advance_state.sh drift-to-research (wrong assumptions)" >&2
      exit 1
    fi
  fi

  local count
  count=$(grep -c . "$PLAN_FILES" 2>/dev/null || echo "0")
  echo "  ✓ All $count planned files exist on disk"
  echo "  ✓ No unplanned files (drift-free)"
}

check_test_gate() {
  if [[ ! -f "$VERIFIED_LOCK" ]]; then
    echo "ERROR: .workflow_verified does not exist." >&2
    echo "" >&2
    echo "  Run 'bash scripts/verify.sh' and ensure all checks pass." >&2
    echo "  verify.sh writes .workflow_verified only on full success." >&2
    echo "" >&2
    echo "  Cannot advance from TEST without a passing verification run." >&2
    exit 1
  fi

  local verified_at
  verified_at=$(cat "$VERIFIED_LOCK" 2>/dev/null || echo "unknown")
  echo "  ✓ .workflow_verified — passed at $verified_at"
}

clear_verified_lock() {
  rm -f "$VERIFIED_LOCK" 2>/dev/null || true
}

# ─── Forward transitions ───────────────────────────────────────────────────────

case "$CURRENT:$ACTION" in

  "RESEARCH:next")
    echo "Checking RESEARCH exit criteria..."
    check_research_gate
    clear_verified_lock
    echo "PLAN" > "$STATE_FILE"
    echo "0"    > "$FAILURES_FILE"
    echo ""
    echo "→ State transition: RESEARCH → PLAN"
    echo "  Failure counter reset to 0."
    echo "  Next: create .workflow_plan_files listing every file to create/modify."
    ;;

  "PLAN:next")
    echo "Checking PLAN exit criteria..."
    check_plan_gate
    clear_verified_lock
    echo "IMPLEMENT" > "$STATE_FILE"
    echo "0"         > "$FAILURES_FILE"
    echo ""
    echo "→ State transition: PLAN → IMPLEMENT"
    echo "  Failure counter reset to 0."
    echo "  Next: implement all files listed in .workflow_plan_files."
    ;;

  "IMPLEMENT:next")
    echo "Checking IMPLEMENT exit criteria..."
    check_implement_gate
    clear_verified_lock
    echo "TEST" > "$STATE_FILE"
    echo "0"    > "$FAILURES_FILE"
    echo ""
    echo "→ State transition: IMPLEMENT → TEST"
    echo "  Failure counter reset to 0."
    echo "  Next: run 'bash scripts/verify.sh'."
    ;;

  "TEST:next")
    echo "Checking TEST exit criteria..."
    check_test_gate
    clear_verified_lock
    echo "RESEARCH" > "$STATE_FILE"
    echo "0"        > "$FAILURES_FILE"
    echo ""
    echo "→ Workflow cycle complete. All checks passed."
    echo "  State reset to RESEARCH for next cycle."
    echo "  Confirm PROMPTS.md and docs/ are fully up to date."
    ;;

  "TEST:fail")
    NEW_FAILURES=$((FAILURES + 1))
    echo "$NEW_FAILURES" > "$FAILURES_FILE"
    clear_verified_lock

    if [[ "$NEW_FAILURES" -ge 3 ]]; then
      echo "RESEARCH" > "$STATE_FILE"
      echo "" >&2
      echo "═══════════════════════════════════════════════════════════" >&2
      echo "BLOCKER: Remediation attempt $NEW_FAILURES/3 reached the limit." >&2
      echo "" >&2
      echo "STOP. Do not continue writing code." >&2
      echo "Provide a written blocker summary:" >&2
      echo "  1. The exact failing check (file, line, error message)" >&2
      echo "  2. What was attempted in each of the $NEW_FAILURES remediation loops" >&2
      echo "  3. What is preventing resolution" >&2
      echo "  4. Proposed next steps or questions for the user" >&2
      echo "═══════════════════════════════════════════════════════════" >&2
      exit 1
    fi

    echo "RESEARCH" > "$STATE_FILE"
    echo ""
    echo "→ State transition: TEST → RESEARCH (remediation loop, attempt $NEW_FAILURES/3)"
    echo "  Scope: address ONLY the failing verification check."
    echo "  No new features or unrelated changes allowed."
    echo "  Constrained loop: RESEARCH → PLAN → IMPLEMENT → TEST"
    ;;

  "IMPLEMENT:drift-to-plan")
    if [[ ! -f "$DRIFT_FLAG" ]]; then
      echo "ERROR: No drift detected (.workflow_drift does not exist)." >&2
      exit 1
    fi
    echo ""
    echo "Drift summary (unplanned files):"
    sed 's/^/  /' "$DRIFT_FLAG"
    rm -f "$DRIFT_FLAG"
    clear_verified_lock
    echo "PLAN" > "$STATE_FILE"
    echo "0"    > "$FAILURES_FILE"
    echo ""
    echo "→ Drift recovery: IMPLEMENT → PLAN"
    echo "  Add the above files to .workflow_plan_files, then re-advance to IMPLEMENT."
    ;;

  "IMPLEMENT:drift-to-research")
    if [[ ! -f "$DRIFT_FLAG" ]]; then
      echo "ERROR: No drift detected (.workflow_drift does not exist)." >&2
      exit 1
    fi
    echo ""
    echo "Drift summary (unplanned files):"
    sed 's/^/  /' "$DRIFT_FLAG"
    rm -f "$DRIFT_FLAG"
    clear_verified_lock
    echo "RESEARCH" > "$STATE_FILE"
    echo "0"        > "$FAILURES_FILE"
    echo ""
    echo "→ Drift recovery: IMPLEMENT → RESEARCH"
    ;;

  *)
    echo "ERROR: Invalid transition from '$CURRENT' with action '$ACTION'." >&2
    echo "" >&2
    echo "Valid usage:" >&2
    echo "  bash scripts/advance_state.sh next" >&2
    echo "  bash scripts/advance_state.sh fail" >&2
    echo "  bash scripts/advance_state.sh drift-to-plan" >&2
    echo "  bash scripts/advance_state.sh drift-to-research" >&2
    exit 1
    ;;

esac
