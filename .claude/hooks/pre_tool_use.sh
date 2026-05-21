#!/usr/bin/env bash
# pre_tool_use.sh — Enforces workflow state boundaries before tool execution.
#
# Receives tool call JSON on stdin (Claude Code hook protocol).
# Exit 0 = allow the tool call.
# Exit 2 = block the tool call; stdout is returned to the model as a rejection message.
#
# Protected state files (.workflow_state, .workflow_failures):
#   These may NEVER be written via Write/Edit. Only advance_state.sh writes them.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_FILE="$PROJECT_ROOT/.workflow_state"
PLAN_FILES="$PROJECT_ROOT/.workflow_plan_files"
DRIFT_FLAG="$PROJECT_ROOT/.workflow_drift"

STATE=$(cat "$STATE_FILE" 2>/dev/null | tr -d '[:space:]' || echo "RESEARCH")

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_name', ''))
except Exception:
    print('')
" 2>/dev/null || true)

# ─── Helpers ────────────────────────────────────────────────────────────────

# Returns 0 if the path is a What2Watch application file that should be gated.
is_app_file() {
  local p="$1"
  p="${p#"$PROJECT_ROOT"/}"
  p="${p#./}"
  case "$p" in
    app/*|lib/*|components/*|types/*|prisma/*|__tests__/*)
      return 0 ;;
    auth.ts|package.json|package-lock.json|tsconfig.json|next.config.ts|tailwind.config.ts|jest.config.ts|jest.setup.ts|eslint.config.mjs|postcss.config.js|prisma.config.ts)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

# Returns 0 if the path is a workflow/planning file always allowed for writing.
is_planning_file() {
  local p="$1"
  p="${p#"$PROJECT_ROOT"/}"
  p="${p#./}"
  case "$p" in
    .workflow_plan_files|.workflow_activity|.workflow_drift)
      return 0 ;;
    AGENTS.md|PROMPTS.md|README.md|docs/*|.claude/*|scripts/*|*.md)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

# Returns 0 if the path is a workflow control file managed exclusively by advance_state.sh.
# These are NEVER writable via the Write/Edit tool — in any state.
is_protected_state_file() {
  local p="$1"
  p="${p#"$PROJECT_ROOT"/}"
  p="${p#./}"
  case "$p" in
    .workflow_state|.workflow_failures)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

# Returns 0 if the path is listed in .workflow_plan_files (exact full-line match).
is_planned_file() {
  local p="$1"
  p="${p#"$PROJECT_ROOT"/}"
  p="${p#./}"
  [[ -f "$PLAN_FILES" ]] && grep -qxF "$p" "$PLAN_FILES" 2>/dev/null
}

# Returns 0 if the bash command contains implementation operations blocked in RESEARCH/PLAN.
is_impl_command() {
  local cmd="$1"

  # Named implementation commands: package installation and database mutations
  if echo "$cmd" | grep -qE \
    'npm[[:space:]]+(install|ci|add|remove|uninstall)|npx[[:space:]]+prisma[[:space:]]+(migrate|db[[:space:]]+(push|seed|reset)|generate)|prisma[[:space:]]+(migrate|db[[:space:]]+(push|seed|reset))' \
    2>/dev/null; then
    return 0
  fi

  # Shell redirects targeting tracked application directories
  if echo "$cmd" | grep -qE \
    '(>>?|[[:space:]]tee[[:space:]])[[:space:]]*("|'"'"')?(app|lib|components|types|prisma|__tests__)\/' \
    2>/dev/null; then
    return 0
  fi

  return 1
}

# ─── Drift check ─────────────────────────────────────────────────────────────

check_drift_flag() {
  if [[ -f "$DRIFT_FLAG" ]]; then
    echo "BLOCKED [IMPLEMENT state]: Unplanned files were detected. Resolve drift before continuing."
    echo ""
    echo "Unplanned files:"
    sed 's/^/  /' "$DRIFT_FLAG" 2>/dev/null || echo "  (see .workflow_drift)"
    echo ""
    echo "Recovery options:"
    echo "  1. Delete each unplanned file and run: rm .workflow_drift"
    echo "     Then continue working in IMPLEMENT."
    echo "  2. bash scripts/advance_state.sh drift-to-plan"
    echo "     Return to PLAN to add the files to .workflow_plan_files."
    echo "  3. bash scripts/advance_state.sh drift-to-research"
    echo "     Return to RESEARCH if requirements or environment assumptions were wrong."
    exit 2
  fi
}

# ─── File write enforcement ───────────────────────────────────────────────────

check_file_write() {
  local file_path="$1"
  [[ -z "$file_path" ]] && return 0

  if is_protected_state_file "$file_path"; then
    echo "BLOCKED: '$file_path' is a protected workflow control file."
    echo ""
    echo ".workflow_state and .workflow_failures are managed exclusively by scripts/advance_state.sh."
    echo "Direct writes are blocked in all workflow states."
    echo ""
    echo "To change workflow state, use:"
    echo "  bash scripts/advance_state.sh next"
    echo "  bash scripts/advance_state.sh fail"
    echo "  bash scripts/advance_state.sh drift-to-plan"
    echo "  bash scripts/advance_state.sh drift-to-research"
    exit 2
  fi

  case "$STATE" in
    RESEARCH)
      if is_app_file "$file_path" && ! is_planning_file "$file_path"; then
        echo "BLOCKED [RESEARCH state]: Writing application files is forbidden."
        echo "File: $file_path"
        echo ""
        echo "Allowed: read files, research requirements, update docs/, AGENTS.md, PROMPTS.md."
        echo "To advance: create docs/research.md with all required sections,"
        echo "  log research prompt in PROMPTS.md, then: bash scripts/advance_state.sh next"
        exit 2
      fi
      ;;

    PLAN)
      if is_app_file "$file_path" && ! is_planning_file "$file_path"; then
        echo "BLOCKED [PLAN state]: Writing application code is forbidden during PLAN."
        echo "File: $file_path"
        echo ""
        echo "Allowed: .workflow_plan_files, AGENTS.md, PROMPTS.md, docs/, scripts/, *.md"
        echo "To advance: complete .workflow_plan_files manifest, then: bash scripts/advance_state.sh next"
        exit 2
      fi
      ;;

    IMPLEMENT)
      check_drift_flag
      if is_app_file "$file_path" && ! is_planned_file "$file_path"; then
        echo "BLOCKED [IMPLEMENT state]: '$file_path' is not in .workflow_plan_files."
        echo ""
        echo "Only files listed in .workflow_plan_files may be written during IMPLEMENT."
        if [[ -f "$PLAN_FILES" ]]; then
          echo ""
          echo "Current manifest (.workflow_plan_files):"
          cat "$PLAN_FILES"
        fi
        echo ""
        echo "To add this file to the plan: edit .workflow_plan_files (add path on its own line)."
        exit 2
      fi
      ;;

    TEST)
      if is_app_file "$file_path" && ! is_planning_file "$file_path"; then
        echo "BLOCKED [TEST state]: Do not modify application files while verification is running."
        echo "File: $file_path"
        echo ""
        echo "Run 'bash scripts/verify.sh' first. If all checks pass, advance state."
        echo "If checks fail: bash scripts/advance_state.sh fail"
        exit 2
      fi
      ;;
  esac
}

# ─── Bash command enforcement ────────────────────────────────────────────────

check_bash_command() {
  local cmd="$1"
  [[ -z "$cmd" ]] && return 0

  if echo "$cmd" | grep -qE '(>>?|[[:space:]]tee[[:space:]])[[:space:]]*\.workflow_(state|failures)' 2>/dev/null; then
    echo "BLOCKED: Cannot write to protected state file via shell redirect."
    echo "Command: $cmd"
    echo ""
    echo ".workflow_state and .workflow_failures are managed only by scripts/advance_state.sh."
    exit 2
  fi

  case "$STATE" in
    RESEARCH|PLAN)
      if is_impl_command "$cmd"; then
        echo "BLOCKED [$STATE state]: Implementation commands are forbidden in $STATE state."
        echo "Command: $cmd"
        echo ""
        echo "Blocked: npm install/add/remove/ci, npx prisma migrate/db push/generate,"
        echo "  prisma migrate/db push, and shell redirects (>, >>, tee) targeting"
        echo "  app/lib/components/types/prisma/__tests__ paths."
        echo ""
        echo "Complete $STATE work, satisfy exit criteria, then advance:"
        echo "  bash scripts/advance_state.sh next"
        exit 2
      fi
      ;;

    IMPLEMENT)
      check_drift_flag
      ;;
    # TEST: allow Bash freely (verify.sh, npm test, etc.)
  esac
}

# ─── Dispatch by tool name ───────────────────────────────────────────────────

case "$TOOL_NAME" in
  Write)
    FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || true)
    check_file_write "$FILE_PATH"
    ;;

  Edit)
    FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || true)
    check_file_write "$FILE_PATH"
    ;;

  Bash)
    COMMAND=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', ''))
except Exception:
    print('')
" 2>/dev/null || true)
    check_bash_command "$COMMAND"
    ;;
esac

exit 0
