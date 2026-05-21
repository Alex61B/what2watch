#!/usr/bin/env bash
# verify.sh — Runs all deterministic verification checks for What2Watch.
#
# On success: writes .workflow_verified (required by TEST → done gate).
# On failure: removes .workflow_verified and exits 1.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

VERIFIED_LOCK="$PROJECT_ROOT/.workflow_verified"
STATE=$(cat .workflow_state 2>/dev/null | tr -d '[:space:]' || echo "UNKNOWN")

rm -f "$VERIFIED_LOCK" 2>/dev/null || true

echo "═══════════════════════════════════════════════════"
echo "  Workflow Verification Suite — What2Watch"
echo "  State: $STATE"
echo "  $(date)"
echo "═══════════════════════════════════════════════════"
echo ""

fail() {
  local check="$1"
  local hint="$2"
  echo ""
  echo "VERIFICATION FAILED: $check"
  echo "$hint"
  echo ""
  echo "Fix the failure, then re-run: bash scripts/verify.sh"
  echo "If this is a repeated failure: bash scripts/advance_state.sh fail"
  rm -f "$VERIFIED_LOCK" 2>/dev/null || true
  exit 1
}

# ─── 1. TypeScript type check ────────────────────────────────────────────────

echo "[ 1/3 ] Running TypeScript type check..."
if ! npm run typecheck 2>&1; then
  fail "TypeScript type check failed" "Fix all type errors before advancing."
fi
echo "        ✓ TypeScript type check passed"
echo ""

# ─── 2. ESLint ───────────────────────────────────────────────────────────────

echo "[ 2/3 ] Running ESLint..."
if ! npm run lint 2>&1; then
  fail "ESLint reported errors" "Fix all lint errors before advancing."
fi
echo "        ✓ ESLint passed"
echo ""

# ─── 3. Jest tests ───────────────────────────────────────────────────────────

echo "[ 3/3 ] Running Jest tests..."
if ! npm test -- --passWithNoTests 2>&1; then
  fail "Jest reported failures" "Fix all failing tests before advancing."
fi
echo "        ✓ All tests passed"
echo ""

# ─── Write verification lock ────────────────────────────────────────────────

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")
echo "$TIMESTAMP" > "$VERIFIED_LOCK"

echo "═══════════════════════════════════════════════════"
echo "  All verification checks passed."
echo "  Lock written: .workflow_verified ($TIMESTAMP)"
echo ""
echo "  Remaining TEST exit criteria (manual):"
echo "    [ ] PROMPTS.md contains all development prompts"
echo "    [ ] README.md has current setup instructions"
echo ""
echo "  When complete: bash scripts/advance_state.sh next"
echo "═══════════════════════════════════════════════════"
