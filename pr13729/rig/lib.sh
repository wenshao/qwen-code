# Shared helpers for the PR 13729 tmux rig. Source, do not execute.
RIG=/Users/wenshao/pr13729-rig
SOCK=pr13729
tm() { tmux -L "$SOCK" "$@"; }

# setup_run <arm> <scenario>: fresh HOME + workspace, starts the mock.
setup_run() {
  ARM=$1; SCEN=$2; RUN=$RIG/runs/$SCEN-$ARM
  rm -rf "$RUN"; mkdir -p "$RUN/home/.qwen" "$RUN/ws" "$RUN/caps"
  WS=$RUN/ws; H=$RUN/home
  printf 'BASELINE\n' > "$WS/state.txt"
  git -C "$WS" init -q && git -C "$WS" add -A && git -C "$WS" -c user.name=r -c user.email=r@l commit -qm init
  cat > "$H/.qwen/settings.json" <<JSON
{
  "security": { "folderTrust": { "enabled": false }, "auth": { "selectedType": "openai" } },
  "ui": { "hideTips": true, "enableFollowupSuggestions": false },
  "general": { "enableAutoUpdate": false }
}
JSON
  node "$RIG/mock.mjs" 0 "$WS" "$RUN/mock.jsonl" > "$RUN/mock.out" 2>&1 &
  MOCKPID=$!; echo $MOCKPID > "$RUN/mock.pid"
  for i in $(seq 1 100); do grep -q BASEURL "$RUN/mock.out" && break; sleep 0.2; done
  BASE=$(awk '/BASEURL/{print $2}' "$RUN/mock.out")
  [ -n "$BASE" ] || { echo "mock failed"; cat "$RUN/mock.out"; return 1; }
  echo "run=$RUN base=$BASE mockpid=$MOCKPID"
}

cli_env() {
  echo env -i HOME="$H" PATH="$(dirname "$(which node)"):/usr/bin:/bin:/usr/sbin:/sbin" TERM=xterm-256color LANG=en_US.UTF-8 COLORTERM=truecolor
}
cli_args() {
  echo --approval-mode yolo --auth-type openai --openai-api-key dummy --openai-base-url "$BASE" --model dummy
}

# wait_for <session> <regex> [timeout-seconds]
wait_for() {
  local s=$1 re=$2 to=${3:-60} i
  for i in $(seq 1 $((to*4))); do
    tm capture-pane -p -t "$s" 2>/dev/null | grep -E -q -- "$re" && return 0
    sleep 0.25
  done
  echo "TIMEOUT waiting for /$re/ in $s" >&2
  tm capture-pane -p -t "$s" | tail -30 >&2
  return 1
}
cap() { tm capture-pane -p -e -t "$1" > "$RUN/caps/$2.ansi"; tm capture-pane -p -t "$1" > "$RUN/caps/$2.txt"; }
