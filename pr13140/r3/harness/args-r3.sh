#!/bin/bash
# Round 3 argv checks. DOCKER_HOST only for the `qwen sandbox` report rows (never for default-command rows).
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4bc58a7c-2b06-4022-98dd-e3f296888d77/scratchpad
NODE=$(command -v node); ND=$(dirname "$NODE")
run() { label="$1"; dh="$2"; shift 2; for arm in base pr; do F=$(mktemp -d "$S/r3args.XXXX"); mkdir -p "$F/home/.qwen" "$F/ws"; cd "$F/ws";
  out=$(perl -e 'alarm shift; exec @ARGV' 40 env -i PATH="$ND:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin" HOME="$F/home" TERM=dumb NO_COLOR=1 QWEN_CODE_SYSTEM_SETTINGS_PATH="$F/s.json" QWEN_CODE_SYSTEM_DEFAULTS_PATH="$F/d.json" ${dh:+DOCKER_HOST=unix://$HOME/.colima/default/docker.sock} $EXTRA "$NODE" "$S/wt-$arm/dist/cli.js" "$@" 2>&1 </dev/null); rc=$?
  ws=$([ -f "$F/ws/.qwen/settings.json" ] && echo set)
  printf '%-40s %-4s exit=%-3s %-3s :: %s\n' "$label" "$arm" "$rc" "$ws" "$(echo "$out" | grep -v '^$' | head -1 | cut -c1-120)"; done; }
EXTRA= run "sandbox --sandbox" 1 sandbox --sandbox
EXTRA= run "sandbox -s" 1 sandbox -s
EXTRA= run "sandbox --sandbox Docker" 1 sandbox --sandbox Docker
EXTRA= run "sandbox --sandbox docker" 1 sandbox --sandbox docker
EXTRA= run "sandbox --sandbox=TRUE" 1 sandbox --sandbox=TRUE
EXTRA= run "sandbox --sandbox 0" 1 sandbox --sandbox 0
EXTRA= run "--debug mcp add -s project srv npx -y foo" "" --debug mcp add -s project srv npx -y foo
EXTRA= run "--sandbox=sandbox-exec mcp list" "" --sandbox=sandbox-exec mcp list
EXTRA= run "--sandbox=true 'explain the parser' (new SDK)" "" --sandbox=true "explain the parser"
EXTRA= run "--sandbox 'explain the parser' (SDK 0.1.17)" "" --sandbox "explain the parser"
EXTRA= run "--sandbox -p hi" "" --sandbox -p hi
EXTRA= run "--sandbox bwrap -p hi" "" --sandbox bwrap -p hi
