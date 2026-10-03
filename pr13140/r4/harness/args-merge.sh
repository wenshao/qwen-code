#!/bin/bash
# Round 4: argv + operator-settings sanity on the PR head vs the trial merge with current main.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4bc58a7c-2b06-4022-98dd-e3f296888d77/scratchpad
NODE=$(command -v node); ND=$(dirname "$NODE")
run() { label="$1"; dh="$2"; mal="$3"; shift 3; for arm in pr merge; do F=$(mktemp -d "$S/r4args.XXXX"); mkdir -p "$F/home/.qwen" "$F/ws"; cd "$F/ws";
  [ -n "$mal" ] && printf '{"tools": {"executionSandbox": {"backend": "bwrap",\n' > "$F/home/.qwen/settings.json"
  out=$(perl -e 'alarm shift; exec @ARGV' 40 env -i PATH="$ND:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin" HOME="$F/home" TERM=dumb NO_COLOR=1 QWEN_CODE_SYSTEM_SETTINGS_PATH="$F/s.json" QWEN_CODE_SYSTEM_DEFAULTS_PATH="$F/d.json" ${dh:+DOCKER_HOST=unix://$HOME/.colima/default/docker.sock} "$NODE" "$S/wt-$arm/dist/cli.js" "$@" 2>&1 </dev/null); rc=$?
  ws=$([ -f "$F/ws/.qwen/settings.json" ] && echo set)
  printf '%-40s %-5s exit=%-3s %-3s :: %s\n' "$label" "$arm" "$rc" "$ws" "$(echo "$out" | grep -v '^$' | head -1 | cut -c1-110)"; done; }
run "sandbox --sandbox" 1 "" sandbox --sandbox
run "sandbox --sandbox Docker" 1 "" sandbox --sandbox Docker
run "sandbox --sandbox 0" 1 "" sandbox --sandbox 0
run "--debug mcp add -s project srv npx -y foo" "" "" --debug mcp add -s project srv npx -y foo
run "--sandbox=sandbox-exec mcp list" "" "" --sandbox=sandbox-exec mcp list
run "--sandbox bwrap -p hi" "" "" --sandbox bwrap -p hi
run "--sandbox -p hi" "" "" --sandbox -p hi
run "malformed User settings: -p hi" "" 1 -p hi
run "malformed User settings: mcp list" "" 1 mcp list
