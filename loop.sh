#!/usr/bin/env bash
# Ralph loop runner — feeds the same prompt to a fresh Claude Code session, over and over.
#
#   ./loop.sh plan  [N]   planning mode: (re)generate IMPLEMENTATION_PLAN.md  (default N=1)
#   ./loop.sh build [N]   building mode: one plan item per iteration          (default N=10, 0 = unlimited)
#   ./loop.sh review [N]  review mode: record confirmed defects in the plan   (default N=1)
#
# Environment:
#   RALPH_MODEL=...             main agent model (default: plan=opus, build=haiku, review=opus)
#   RALPH_SUBAGENT_MODEL=...    subagent model (default: same as the main agent)
#   RALPH_YOLO=1                use --dangerously-skip-permissions (isolated sandbox/container only)
#   RALPH_BUDGET_USD=2          per-iteration spend cap (--max-budget-usd)
#   RALPH_TOTAL_BUDGET_USD=10   stop once this run has spent this much (checked after each iteration)
#   RALPH_MAX_NO_PROGRESS=3     stop after N build iterations in a row without a new commit
#   RALPH_AUTONOMOUS=1          no human in the loop: append PROMPT_autonomy.md (used by cycle.sh)
#   RALPH_REVIEW_MIN_SEVERITY=  review mode records only findings at or above low|medium|high (default: all)
#   RALPH_CHECK_CMD=...         command that must pass before a build COMPLETE is accepted (default: npm run check)
#   RALPH_PUSH=1                git push after every iteration
#
# Exit codes: 0 COMPLETE · 10 max iterations · 2 no progress · 20 stop requested · 30 total budget
#             40 usage limit reached · 1 claude kept failing · 130 Ctrl+C
# The last run's mode, exit code, iterations, cost and any usage limit are written to .ralph/last-run
# (read by cycle.sh).
#
# Graceful stop (after the current iteration): ./stop.sh  (or touch .ralph/STOP)
set -euo pipefail

cd "$(dirname "$0")"

MODE="${1:-build}"
case "$MODE" in
  plan)  PROMPT_FILE=PROMPT_plan.md;  MAX_ITERATIONS="${2:-1}";  DEFAULT_MODEL=opus ;;
  build) PROMPT_FILE=PROMPT_build.md; MAX_ITERATIONS="${2:-10}"; DEFAULT_MODEL=haiku ;;
  review) PROMPT_FILE=PROMPT_review.md; MAX_ITERATIONS="${2:-1}"; DEFAULT_MODEL=opus ;;
  *) echo "usage: $0 [plan|build|review] [max_iterations]" >&2; exit 64 ;;
esac

MODEL="${RALPH_MODEL:-$DEFAULT_MODEL}"
SUBAGENT_MODEL="${RALPH_SUBAGENT_MODEL:-$MODEL}"
MAX_NO_PROGRESS="${RALPH_MAX_NO_PROGRESS:-3}"
TOTAL_BUDGET="${RALPH_TOTAL_BUDGET_USD:-}"
CHECK_CMD="${RALPH_CHECK_CMD:-npm run check}"
LOG_DIR=.ralph/logs
STOP_FILE=.ralph/STOP
LAST_RUN=.ralph/last-run
AUTONOMY_FILE=PROMPT_autonomy.md
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
if [[ "$MODE" == review ]]; then
  # Review records defects; the build loop fixes them. Enforce that here instead of trusting the prompt:
  # only IMPLEMENTATION_PLAN.md stays writable, and nothing can be committed.
  # An Edit(path) rule covers every file-editing tool (Write included); Write(path) rules are ignored.
  CLAUDE_ARGS+=(--disallowedTools
    "Edit(./src/**)" "Edit(./public/**)" "Edit(./tests/**)" "Edit(./AGENTS.md)"
    "Bash(git add *)" "Bash(git commit *)" "Bash(rm *)" "Bash(npm install *)")
fi
# Run-time rules ride on the system prompt, so the PROMPT_*.md files stay the same across runs.
extra=""
AUTONOMY=off
if [[ "${RALPH_AUTONOMOUS:-0}" == 1 ]]; then
  [[ -f "$AUTONOMY_FILE" ]] || { echo "error: $AUTONOMY_FILE not found" >&2; exit 66; }
  extra="$(cat "$AUTONOMY_FILE")"
  AUTONOMY=on
fi
SEVERITY=all
if [[ "$MODE" == review && -n "${RALPH_REVIEW_MIN_SEVERITY:-}" ]]; then
  case "$RALPH_REVIEW_MIN_SEVERITY" in
    low | medium | high) ;;
    *) echo "error: RALPH_REVIEW_MIN_SEVERITY must be low, medium or high" >&2; exit 64 ;;
  esac
  extra+="${extra:+$'\n\n'}This review records only findings of severity ${RALPH_REVIEW_MIN_SEVERITY} or higher (low < medium < high)."
  SEVERITY="≥ $RALPH_REVIEW_MIN_SEVERITY"
fi
[[ -n "$extra" ]] && CLAUDE_ARGS+=(--append-system-prompt "$extra")
[[ -n "${RALPH_BUDGET_USD:-}" ]] && CLAUDE_ARGS+=(--max-budget-usd "$RALPH_BUDGET_USD")

BRANCH="$(git branch --show-current)"
mkdir -p "$LOG_DIR"
rm -f "$STOP_FILE"

iteration=0
no_progress=0
failures=0
total_cost=0
limit_msg=""
limit_reset=""

summary() {
  echo
  echo "──────── Ralph summary ────────"
  echo "mode:        $MODE"
  echo "iterations:  $iteration"
  echo "total cost:  \$$total_cost"
  echo "logs:        $LOG_DIR/"
}

# Every exit goes through here so the summary and .ralph/last-run are always written.
finish() {
  summary
  printf 'mode=%s\nexit=%s\niterations=%s\ncost=%s\nlimit=%s\nresets_at=%s\n' \
    "$MODE" "$1" "$iteration" "$total_cost" "$limit_msg" "$limit_reset" > "$LAST_RUN"
  exit "$1"
}
trap 'finish 130' INT

# A usage limit (HTTP 429) lasts hours, so retrying it like a crash only burns the retries.
# Sets $limit_msg and, when the log reports it, $limit_reset (epoch seconds).
usage_limited() {
  limit_msg="$(jq -Rr 'fromjson? | select(.type == "result" and .api_error_status == 429)
    | .result // "usage limit reached"' "$log" | tail -n 1)"
  [[ -n "$limit_msg" ]] || return 1
  limit_reset="$(jq -Rr 'fromjson? | select(.type == "rate_limit_event" and .rate_limit_info.status == "rejected")
    | .rate_limit_info.resetsAt // empty' "$log" | tail -n 1)"
}

changed_besides_plan() {
  git status --porcelain -- . ':(exclude)IMPLEMENTATION_PLAN.md'
}

# A build COMPLETE is a claim; accept it only if the gates pass and everything is committed.
verify_complete() {
  local check_log="${log%.jsonl}-check.log"
  if ! bash -c "$CHECK_CMD" > "$check_log" 2>&1; then
    echo "⚠️  COMPLETE rejected: '$CHECK_CMD' failed (see $check_log)"; return 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "⚠️  COMPLETE rejected: uncommitted changes"; git status --short; return 1
  fi
}

echo "──────── Ralph loop ────────"
echo "mode:        $MODE ($PROMPT_FILE)"
echo "max:         $([[ $MAX_ITERATIONS == 0 ]] && echo unlimited || echo "$MAX_ITERATIONS") iterations"
echo "model:       $MODEL"
echo "subagent:    $SUBAGENT_MODEL"
echo "permissions: $PERMISSIONS"
echo "autonomous:  $AUTONOMY"
[[ "$MODE" == review ]] && echo "severity:    $SEVERITY"
echo "budget:      $([[ -n $TOTAL_BUDGET ]] && echo "\$$TOTAL_BUDGET total" || echo none)"
echo "branch:      $BRANCH"
echo "stop:        ./stop.sh  (graceful, or touch $STOP_FILE)  ·  Ctrl+C (immediate)"

# --- loop ------------------------------------------------------------------
while :; do
  if (( MAX_ITERATIONS > 0 && iteration >= MAX_ITERATIONS )); then
    echo; echo "reached max iterations ($MAX_ITERATIONS)"; finish 10
  fi
  if [[ -f "$STOP_FILE" ]]; then
    rm -f "$STOP_FILE"; echo; echo "stop requested via $STOP_FILE"; finish 20
  fi

  iteration=$((iteration + 1))
  log="$LOG_DIR/$(date +%Y%m%d-%H%M%S)-${MODE}-$(printf %03d "$iteration").jsonl"
  head_before="$(git rev-parse HEAD)"
  others_before="$(changed_besides_plan)"

  echo
  echo "════════ $MODE iteration $iteration — $(date '+%H:%M:%S') ════════"

  set +e
  CLAUDE_CODE_SUBAGENT_MODEL="$SUBAGENT_MODEL" claude "${CLAUDE_ARGS[@]}" < "$PROMPT_FILE" | tee "$log" | jq -Rrj --unbuffered -f scripts/pretty.jq
  status=${PIPESTATUS[0]}
  set -e

  cost="$(jq -Rr 'fromjson? | select(.type == "result") | .total_cost_usd // 0' "$log" | tail -n 1)"
  total_cost="$(awk -v a="$total_cost" -v b="${cost:-0}" 'BEGIN { printf "%.4f", a + b }')"

  if usage_limited; then
    echo; echo "stopping: $limit_msg"
    if [[ -n "$limit_reset" ]]; then
      echo "resets at:   $(date -r "$limit_reset" '+%Y-%m-%d %H:%M' 2>/dev/null || date -d "@$limit_reset" '+%Y-%m-%d %H:%M')"
    fi
    finish 40
  fi
  if (( status != 0 )); then
    failures=$((failures + 1))
    echo "claude exited with status $status (consecutive failures: $failures)" >&2
    if (( failures >= 3 )); then finish 1; fi
    sleep $((failures * 30))
    continue
  fi
  failures=0

  # plan and review may only write the plan; flag anything else they touched for a human to inspect.
  if [[ "$MODE" != build ]]; then
    others_after="$(changed_besides_plan)"
    if [[ "$others_after" != "$others_before" || "$(git rev-parse HEAD)" != "$head_before" ]]; then
      echo "⚠️  $MODE changed more than IMPLEMENTATION_PLAN.md — inspect with: git status; git log -1"
      echo "$others_after"
    fi
  fi

  # The token must be a whole line: mentioning it inside a sentence is not completion.
  if jq -Rr 'fromjson? | select(.type == "result") | .result // ""' "$log" \
      | grep -qxE "[[:space:]]*${COMPLETE_TOKEN}[[:space:]]*"; then
    if [[ "$MODE" != build ]] || verify_complete; then
      echo; echo "✅ Ralph reported COMPLETE"; finish 0
    fi
  fi

  if [[ "$MODE" == build ]]; then
    if [[ "$(git rev-parse HEAD)" == "$head_before" ]]; then
      no_progress=$((no_progress + 1))
      echo "⚠️  no new commit this iteration ($no_progress/$MAX_NO_PROGRESS)"
      if (( no_progress >= MAX_NO_PROGRESS )); then
        echo "stopping: no progress — inspect $LOG_DIR and tune the prompts/plan" >&2
        finish 2
      fi
    else
      no_progress=0
      git --no-pager log --oneline "$head_before"..HEAD
    fi
  fi

  if [[ "${RALPH_PUSH:-0}" == 1 ]]; then
    git push origin "$BRANCH" || git push -u origin "$BRANCH"
  fi

  if [[ -n "$TOTAL_BUDGET" ]] && awk -v a="$total_cost" -v b="$TOTAL_BUDGET" 'BEGIN { exit !(a >= b) }'; then
    echo; echo "stopping: spent \$$total_cost of the \$$TOTAL_BUDGET budget"; finish 30
  fi
done
