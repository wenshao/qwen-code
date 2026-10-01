#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4bc58a7c-2b06-4022-98dd-e3f296888d77/scratchpad
NODE=$(command -v node); ND=$(dirname "$NODE")
run() { label="$1"; shift; for arm in base pr; do F=$(mktemp -d "$S/r2args.XXXX"); mkdir -p "$F/home/.qwen" "$F/ws"; cd "$F/ws";
  out=$(perl -e 'alarm shift; exec @ARGV' 40 env -i PATH="$ND:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin" HOME="$F/home" TERM=dumb NO_COLOR=1 QWEN_CODE_SYSTEM_SETTINGS_PATH="$F/s.json" QWEN_CODE_SYSTEM_DEFAULTS_PATH="$F/d.json" DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" $EXTRA "$NODE" "$S/wt-$arm/dist/cli.js" "$@" 2>&1 </dev/null); rc=$?
  printf '%-36s %-4s exit=%-3s :: %s\n' "$label" "$arm" "$rc" "$(echo "$out" | grep -v '^$' | head -1 | cut -c1-140)"; done; }
EXTRA= run "sandbox --sandbox" sandbox --sandbox
EXTRA= run "sandbox -s" sandbox -s
EXTRA= run "sandbox --sandbox true" sandbox --sandbox true
EXTRA= run "sandbox --sandbox=true" sandbox --sandbox=true
EXTRA= run "sandbox --sandbox Docker" sandbox --sandbox Docker
EXTRA= run "sandbox --sandbox docker" sandbox --sandbox docker
EXTRA=QWEN_SANDBOX=true run "QWEN_SANDBOX=true sandbox" sandbox
EXTRA= run "--sandbox Docker -p hi" --sandbox Docker -p hi
EXTRA= run "--sandbox -p hi" --sandbox -p hi
