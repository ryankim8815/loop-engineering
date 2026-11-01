#!/usr/bin/env bash
# Graceful stop for loop.sh — the current iteration finishes (implement → check → commit), then the loop exits.
#
#   ./stop.sh            request a stop (creates .ralph/STOP)
#   ./stop.sh --wait     request a stop and wait until the loop has exited
#   ./stop.sh --cancel   withdraw a pending stop request
#   ./stop.sh --status   show whether a loop is running and whether a stop is pending
#
# Environment:
#   RALPH_STOP_TIMEOUT=1800   max seconds to wait with --wait (0 = no limit)
set -euo pipefail

cd "$(dirname "$0")"

STOP_FILE=.ralph/STOP
REPO_DIR="$(pwd -P)"
TIMEOUT="${RALPH_STOP_TIMEOUT:-1800}"

# PIDs of loop.sh processes whose working directory is this repo (loop.sh cd's into its own directory).
loop_pids() {
  local pid cwd
  for pid in $(pgrep -f 'loop\.sh (plan|build|review)' 2>/dev/null || true); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    [[ "$cwd" == "$REPO_DIR" ]] && echo "$pid"
  done
  return 0
}

describe_loops() {
  local pid
  for pid in "$@"; do
    echo "  pid $pid: $(ps -o command= -p "$pid" 2>/dev/null | sed 's/^.*\(loop\.sh .*\)$/\1/')"
  done
}

ACTION="${1:-stop}"
case "$ACTION" in
  stop | --wait) ;;
  --cancel)
    if [[ -f "$STOP_FILE" ]]; then rm -f "$STOP_FILE"; echo "stop request withdrawn"; else echo "no pending stop request"; fi
    exit 0
    ;;
  --status)
    pids=($(loop_pids))
    if (( ${#pids[@]} == 0 )); then echo "loop: not running"; else echo "loop: running"; describe_loops "${pids[@]}"; fi
    if [[ -f "$STOP_FILE" ]]; then echo "stop: pending"; else echo "stop: not requested"; fi
    exit 0
    ;;
  -h | --help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "usage: $0 [--wait | --cancel | --status]" >&2; exit 64 ;;
esac

pids=($(loop_pids))
if (( ${#pids[@]} == 0 )); then
  # loop.sh deletes a stale STOP file on start, so creating one now would do nothing.
  echo "no running loop.sh found in $REPO_DIR — nothing to stop" >&2
  exit 1
fi

mkdir -p "$(dirname "$STOP_FILE")"
touch "$STOP_FILE"
echo "stop requested — the loop exits after its current iteration"
describe_loops "${pids[@]}"

[[ "$ACTION" == --wait ]] || exit 0

echo "waiting for the loop to exit (Ctrl+C stops waiting, not the loop)..."
start=$SECONDS
while [[ -n "$(loop_pids)" ]]; do
  if (( TIMEOUT > 0 && SECONDS - start >= TIMEOUT )); then
    echo "still running after ${TIMEOUT}s — the stop request stays in place" >&2
    exit 2
  fi
  sleep 5
done
echo "loop exited after $((SECONDS - start))s"
git --no-pager log --oneline -3
