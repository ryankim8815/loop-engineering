#!/usr/bin/env bash
# Ralph cycle runner — repeats (build + review) sets without asking a human anything.
#
#   ./cycle.sh [C] [B] [R]   up to C sets of (build ≤ B iterations, then review ≤ R iterations)   (default 3 10 1)
#
# Each loop.sh call runs with RALPH_AUTONOMOUS=1 (PROMPT_autonomy.md): items that need a human go to
# "Blocked" and ambiguous specs get a recorded decision.
#
# Environment (everything else, e.g. RALPH_MODEL, passes through to loop.sh):
#   RALPH_TOTAL_BUDGET_USD=10        spend cap for the whole run (default: none)
#   RALPH_REVIEW_MIN_SEVERITY=medium from the 2nd set on, review records only this severity or higher
#   RALPH_CYCLE_BRANCH=1             run on a new branch ralph/cycle-<timestamp>
#
# Stops early when a set ends with build COMPLETE, review finding nothing new and no open R item left
# (converged), when a set produces neither a commit nor a finding, when build makes no progress in two sets in a row, or on
# budget / stop request / failure.
# Exit codes: 0 converged · 10 max sets · 2 stuck or no progress · 20 stop requested · 30 budget
#             40 usage limit reached · 1 claude kept failing · 130 Ctrl+C
#
# Graceful stop (after the current loop.sh iteration): ./stop.sh
set -uo pipefail

cd "$(dirname "$0")"

CYCLES="${1:-3}"
BUILD_N="${2:-10}"
REVIEW_N="${3:-1}"
for n in "$CYCLES" "$BUILD_N" "$REVIEW_N"; do
  [[ "$n" =~ ^[1-9][0-9]*$ ]] || { echo "usage: $0 [sets] [build_per_set] [review_per_set]  (positive integers)" >&2; exit 64; }
done

TOTAL_BUDGET="${RALPH_TOTAL_BUDGET_USD:-}"
MIN_SEVERITY="${RALPH_REVIEW_MIN_SEVERITY:-medium}"
STOP_FILE=.ralph/STOP
LAST_RUN=.ralph/last-run
PLAN=IMPLEMENTATION_PLAN.md

git rev-parse HEAD >/dev/null 2>&1 || { echo "error: no git commit yet" >&2; exit 65; }
if [[ "${RALPH_CYCLE_BRANCH:-0}" == 1 ]]; then
  git switch -c "ralph/cycle-$(date +%Y%m%d-%H%M%S)" || exit 1
fi
mkdir -p .ralph
rm -f "$STOP_FILE"

total_cost=0
prev_build=""
cycle=0
reason=""
code=10
report=()
limit_note=""

# Unchecked R items outside "## Blocked": a blocked finding waits for a human and must not hold up convergence.
open_findings() {
  awk '/^## / { blocked = /^## Blocked/ } !blocked && /^[[:space:]]*- \[ \] \*\*R[0-9]+/ { n++ } END { print n + 0 }' \
    "$PLAN" 2>/dev/null || echo 0
}

add_cost() { total_cost="$(awk -v a="$total_cost" -v b="${1:-0}" 'BEGIN { printf "%.4f", a + b }')"; }

over_budget() {
  [[ -n "$TOTAL_BUDGET" ]] && awk -v a="$total_cost" -v b="$TOTAL_BUDGET" 'BEGIN { exit !(a >= b) }'
}

# run <mode> <n> [extra env...] — runs one loop.sh phase and sets $phase_exit
run_phase() {
  local mode=$1 n=$2; shift 2
  local env=(RALPH_AUTONOMOUS=1 "$@")
  if [[ -n "$TOTAL_BUDGET" ]]; then
    env+=(RALPH_TOTAL_BUDGET_USD="$(awk -v a="$TOTAL_BUDGET" -v b="$total_cost" 'BEGIN { printf "%.4f", a - b }')")
  fi
  echo
  echo "━━━━━━━━ set $cycle/$CYCLES · $mode (≤ $n) ━━━━━━━━"
  # loop.sh clears a leftover STOP file on start, so honour one that arrived between phases here.
  if [[ -f "$STOP_FILE" ]]; then rm -f "$STOP_FILE"; echo "stop requested via $STOP_FILE"; phase_exit=20; return; fi
  rm -f "$LAST_RUN"
  # Drop an inherited severity floor: set 1 reviews every severity, later sets pass their own.
  env -u RALPH_REVIEW_MIN_SEVERITY "${env[@]}" ./loop.sh "$mode" "$n"
  phase_exit=$?
  if [[ -f "$LAST_RUN" ]]; then
    add_cost "$(sed -n 's/^cost=//p' "$LAST_RUN")"
    local resets
    resets="$(sed -n 's/^resets_at=//p' "$LAST_RUN")"
    limit_note="$(sed -n 's/^limit=//p' "$LAST_RUN")"
    if [[ -n "$resets" ]]; then
      limit_note="resets $(date -r "$resets" '+%Y-%m-%d %H:%M' 2>/dev/null || date -d "@$resets" '+%Y-%m-%d %H:%M')"
    fi
  fi
}

# Exit codes of loop.sh that end the whole run, and the reason shown for them.
fatal_reason() {
  case "$1" in
    1) echo "claude kept failing" ;;
    20) echo "stop requested" ;;
    30) echo "budget spent" ;;
    40) echo "usage limit reached${limit_note:+ — $limit_note}; re-run after the reset" ;;
    130) echo "interrupted" ;;
    0 | 2 | 10) ;;
    *) echo "loop.sh exited with $1" ;;
  esac
}

summary() {
  echo
  echo "════════ Ralph cycle summary ════════"
  printf '%-4s  %-12s  %-8s  %-12s  %-12s  %s\n' set build commits review "new R items" cost
  local row
  for row in "${report[@]}"; do printf '%s\n' "$row"; done
  echo "total cost:  \$$total_cost${TOTAL_BUDGET:+ of \$$TOTAL_BUDGET}"
  echo "stopped:     $reason"
  # Decisions the agent took on a human's behalf — read these before merging.
  local section
  for section in "Blocked (needs human)" "Decisions (pending human review)"; do
    if grep -q "^## $section" "$PLAN" 2>/dev/null; then
      echo
      echo "── $section ──"
      awk -v h="## $section" '$0 == h { on = 1; next } /^## / { on = 0 } on && NF' "$PLAN"
    fi
  done
}

finish() {
  # Review never commits; keep its findings in history so the next run (or a human) sees them.
  if [[ "$code" != 130 && -n "$(git status --porcelain -- "$PLAN")" ]]; then
    git add "$PLAN" && git commit -q -m "review: record findings (set $cycle)" && echo "committed pending review findings"
  fi
  summary
  exit "$code"
}
trap 'reason="interrupted"; code=130; finish' INT

# add_row <build> <commits> <review> <new findings> — one line of the summary table for the current set
add_row() {
  local spent
  spent="$(awk -v a="$total_cost" -v b="$cost_before" 'BEGIN { printf "%.4f", a - b }')"
  report+=("$(printf '%-4s  %-12s  %-8s  %-12s  %-12s  $%s' "$cycle" "$1" "$2" "$3" "$4" "$spent")")
}

label() {
  case "$1" in
    0) echo COMPLETE ;; 10) echo max ;; 2) echo "no progress" ;; 20) echo stopped ;; 30) echo budget ;;
    40) echo limit ;; 1) echo failed ;; 130) echo interrupted ;; *) echo "exit $1" ;;
  esac
}

echo "──────── Ralph cycle ────────"
echo "sets:        $CYCLES × (build ≤ $BUILD_N + review ≤ $REVIEW_N)"
echo "budget:      $([[ -n $TOTAL_BUDGET ]] && echo "\$$TOTAL_BUDGET total" || echo none)"
echo "review:      all severities in set 1, ≥ $MIN_SEVERITY afterwards"
echo "branch:      $(git branch --show-current)"
echo "stop:        ./stop.sh  ·  Ctrl+C (immediate)"

for ((cycle = 1; cycle <= CYCLES; cycle++)); do
  if [[ -f "$STOP_FILE" ]]; then rm -f "$STOP_FILE"; reason="stop requested"; code=20; break; fi
  if over_budget; then reason="budget spent"; code=30; break; fi

  head_before="$(git rev-parse HEAD)"
  cost_before="$total_cost"

  run_phase build "$BUILD_N"
  build_exit=$phase_exit
  commits="$(git rev-list --count "$head_before"..HEAD)"
  r="$(fatal_reason "$build_exit")"
  if [[ -n "$r" ]]; then
    add_row "$(label "$build_exit")" "$commits" - -
    reason="$r"; code=$build_exit; break
  fi
  if [[ "$build_exit" == 2 && "$prev_build" == 2 ]]; then
    add_row "$(label "$build_exit")" "$commits" - -
    reason="build made no progress in two sets in a row"; code=2; break
  fi
  if over_budget; then
    add_row "$(label "$build_exit")" "$commits" - -
    reason="budget spent"; code=30; break
  fi

  findings_before="$(open_findings)"
  severity_env=()
  (( cycle > 1 )) && severity_env=(RALPH_REVIEW_MIN_SEVERITY="$MIN_SEVERITY")
  run_phase review "$REVIEW_N" ${severity_env[@]+"${severity_env[@]}"}
  review_exit=$phase_exit
  new_findings=$(( $(open_findings) - findings_before ))
  (( new_findings < 0 )) && new_findings=0
  add_row "$(label "$build_exit")" "$commits" "$(label "$review_exit")" "$new_findings"

  r="$(fatal_reason "$review_exit")"
  if [[ -n "$r" ]]; then reason="$r"; code=$review_exit; break; fi
  # A review run can record findings in early iterations and still end COMPLETE, so check the plan as well.
  if [[ "$build_exit" == 0 && "$review_exit" == 0 && "$(open_findings)" == 0 ]]; then
    reason="converged: build COMPLETE, review found nothing new, no open R item"; code=0; break
  fi
  if (( commits == 0 && new_findings == 0 )); then
    reason="no commit and no new finding in set $cycle"; code=2; break
  fi
  prev_build=$build_exit
done

if [[ -z "$reason" ]]; then cycle=$CYCLES; reason="reached max sets ($CYCLES)"; code=10; fi
finish
