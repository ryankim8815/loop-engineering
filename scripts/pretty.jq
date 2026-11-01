# Turns Claude Code `--output-format stream-json` lines into a readable live log.
# Usage: claude -p --output-format stream-json --verbose ... | jq -Rrj --unbuffered -f scripts/pretty.jq

def clip($n): if length > $n then .[0:$n] + "…" else . end;

def tool_arg:
  (.input.command // .input.file_path // .input.pattern // .input.description // .input.prompt // "")
  | tostring | gsub("\n"; " ") | clip(140);

fromjson?
| if .type == "system" and .subtype == "init" then
    "▶ session \(.session_id) · model \(.model)\n"
  elif .type == "assistant" then
    (.message.content[]?
      | if .type == "text" then "\n💬 \(.text)\n"
        elif .type == "tool_use" then "🔧 \(.name) \(tool_arg)\n"
        else empty end)
  elif .type == "result" then
    "\n🏁 \(.subtype) · turns \(.num_turns) · \((.duration_ms // 0) / 1000 | floor)s · $\(.total_cost_usd // 0)\n"
  else empty end
