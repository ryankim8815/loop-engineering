#!/usr/bin/env bash
# Ralph loop runner — feeds the same prompt to a fresh Claude Code session, over and over.
#
#   ./loop.sh plan  [N]   planning mode: (re)generate IMPLEMENTATION_PLAN.md  (default N=1)
#   ./loop.sh build [N]   building mode: one plan item per iteration          (default N=10, 0 = unlimited)
#
# Environment:
#   RALPH_MODEL=opus            model alias or full model name
#   RALPH_YOLO=1                use --dangerously-skip-permissions (isolated sandbox/container only)
#   RALPH_BUDGET_USD=2          per-iteration spend cap (--max-budget-usd)
#   RALPH_MAX_NO_PROGRESS=3     stop after N build iterations in a row without a new commit
#   RALPH_PUSH=1                git push after every iteration
#
# Graceful stop (after the current iteration): touch .ralph/STOP
set -euo pipefail

cd "$(dirname "$0")"

MODE="${1:-build}"
case "$MODE" in
  plan)  PROMPT_FILE=PROMPT_plan.md;  MAX_ITERATIONS="${2:-1}" ;;
  build) PROMPT_FILE=PROMPT_build.md; MAX_ITERATIONS="${2:-10}" ;;
  *) echo "usage: $0 [plan|build] [max_iterations]" >&2; exit 64 ;;
esac

MODEL="${RALPH_MODEL:-opus}"
MAX_NO_PROGRESS="${RALPH_MAX_NO_PROGRESS:-3}"
LOG_DIR=.ralph/logs
STOP_FILE=.ralph/STOP
COMPLETE_TOKEN='<promise>COMPLETE</promise>'

# --- preflight -------------------------------------------------------------
for cmd in claude jq git npm; do
  command -v "$cmd" >/dev/null || { echo "error: '$cmd' not found in PATH" >&2; exit 69; }
done
[[ -f "$PROMPT_FILE" ]] || { echo "error: $PROMPT_FILE not found" >&2; exit 66; }
git rev-parse HEAD >/dev/null 2>&1 || {
  echo "error: no git commit yet — commit the environment first (README: 'Baseline commit')" >&2
  exit 65
}

CLAUDE_ARGS=(-p --output-format stream-json --verbose --model "$MODEL")
if [[ "${RALPH_YOLO:-0}" == 1 ]]; then
  CLAUDE_ARGS+=(--dangerously-skip-permissions)
  PERMISSIONS="bypass (RALPH_YOLO=1)"
else
  # dontAsk: anything not allowed by .claude/settings.json is denied instead of prompting
  CLAUDE_ARGS+=(--permission-mode dontAsk)
  PERMISSIONS="dontAsk + .claude/settings.json allowlist"
fi
[[ -n "${RALPH_BUDGET_USD:-}" ]] && CLAUDE_ARGS+=(--max-budget-usd "$RALPH_BUDGET_USD")

BRANCH="$(git branch --show-current)"
mkdir -p "$LOG_DIR"
rm -f "$STOP_FILE"

iteration=0
no_progress=0
failures=0
total_cost=0

summary() {
  echo
  echo "──────── Ralph summary ────────"
  echo "mode:        $MODE"
  echo "iterations:  $iteration"
  echo "total cost:  \$$total_cost"
  echo "logs:        $LOG_DIR/"
}
trap 'summary; exit 130' INT

echo "──────── Ralph loop ────────"
echo "mode:        $MODE ($PROMPT_FILE)"
echo "max:         $([[ $MAX_ITERATIONS == 0 ]] && echo unlimited || echo "$MAX_ITERATIONS") iterations"
echo "model:       $MODEL"
echo "permissions: $PERMISSIONS"
echo "branch:      $BRANCH"
echo "stop:        touch $STOP_FILE  (or Ctrl+C)"

# --- loop ------------------------------------------------------------------
while :; do
  if (( MAX_ITERATIONS > 0 && iteration >= MAX_ITERATIONS )); then
    echo; echo "reached max iterations ($MAX_ITERATIONS)"; break
  fi
  if [[ -f "$STOP_FILE" ]]; then
    rm -f "$STOP_FILE"; echo; echo "stop requested via $STOP_FILE"; break
  fi

  iteration=$((iteration + 1))
  log="$LOG_DIR/$(date +%Y%m%d-%H%M%S)-${MODE}-$(printf %03d "$iteration").jsonl"
  head_before="$(git rev-parse HEAD)"

  echo
  echo "════════ $MODE iteration $iteration — $(date '+%H:%M:%S') ════════"

  set +e
  claude "${CLAUDE_ARGS[@]}" < "$PROMPT_FILE" | tee "$log" | jq -Rrj --unbuffered -f scripts/pretty.jq
  status=${PIPESTATUS[0]}
  set -e

  cost="$(jq -Rr 'fromjson? | select(.type == "result") | .total_cost_usd // 0' "$log" | tail -n 1)"
  total_cost="$(awk -v a="$total_cost" -v b="${cost:-0}" 'BEGIN { printf "%.4f", a + b }')"

  if (( status != 0 )); then
    failures=$((failures + 1))
    echo "claude exited with status $status (consecutive failures: $failures)" >&2
    if (( failures >= 3 )); then summary; exit 1; fi
    sleep $((failures * 30))
    continue
  fi
  failures=0

  if jq -Rr 'fromjson? | select(.type == "result") | .result // ""' "$log" | grep -qF "$COMPLETE_TOKEN"; then
    echo; echo "✅ Ralph reported COMPLETE"; break
  fi

  if [[ "$MODE" == build ]]; then
    if [[ "$(git rev-parse HEAD)" == "$head_before" ]]; then
      no_progress=$((no_progress + 1))
      echo "⚠️  no new commit this iteration ($no_progress/$MAX_NO_PROGRESS)"
      if (( no_progress >= MAX_NO_PROGRESS )); then
        echo "stopping: no progress — inspect $LOG_DIR and tune the prompts/plan" >&2
        summary; exit 2
      fi
    else
      no_progress=0
      git --no-pager log --oneline "$head_before"..HEAD
    fi
  fi

  if [[ "${RALPH_PUSH:-0}" == 1 ]]; then
    git push origin "$BRANCH" || git push -u origin "$BRANCH"
  fi
done

summary
