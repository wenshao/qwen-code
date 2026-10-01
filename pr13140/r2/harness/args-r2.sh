#!/bin/bash
# R2 argv matrix: base (wt-base) vs head (wt-pr), isolated HOME, stdin </dev/null, 40 s alarm.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4bc58a7c-2b06-4022-98dd-e3f296888d77/scratchpad
NODE=$(command -v node); ND=$(dirname "$NODE")
run() {
  label="$1"; shift
  for arm in base pr; do
    F=$(mktemp -d "$S/r2args.XXXX"); mkdir -p "$F/home/.qwen" "$F/ws"; cd "$F/ws" || exit 1
    out=$(perl -e 'alarm shift; exec @ARGV' 40 env -i PATH="$ND:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$F/home" TERM=dumb NO_COLOR=1 \
      QWEN_CODE_SYSTEM_SETTINGS_PATH="$F/sys.json" QWEN_CODE_SYSTEM_DEFAULTS_PATH="$F/sysdef.json" \
      DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" $EXTRA \
      "$NODE" "$S/wt-$arm/dist/cli.js" "$@" 2>&1 </dev/null); rc=$?
    ws=$(tr -d ' \n' < "$F/ws/.qwen/settings.json" 2>/dev/null | cut -c1-60)
    printf '%-44s %-4s exit=%-3s ws=%-8s :: %s\n' "$label" "$arm" "$rc" "${ws:+set}" \
      "$(echo "$out" | grep -v '^$' | head -2 | tr '\n' '|' | cut -c1-170)"
  done
}
EXTRA= run "sandbox --sandbox docker" sandbox --sandbox docker
EXTRA= run "sandbox --sandbox=docker" sandbox --sandbox=docker
EXTRA= run "sandbox -s docker" sandbox -s docker
EXTRA= run "sandbox --sandbox Docker" sandbox --sandbox Docker
EXTRA= run "sandbox --sandbox sandbox-exec" sandbox --sandbox sandbox-exec
EXTRA= run "sandbox --sandbox" sandbox --sandbox
EXTRA= run "sandbox --sandbox false" sandbox --sandbox false
EXTRA= run "sandbox --no-sandbox" sandbox --no-sandbox
EXTRA=QWEN_SANDBOX=docker run "QWEN_SANDBOX=docker sandbox" sandbox
EXTRA=SANDBOX=Docker run "SANDBOX=Docker sandbox" sandbox
EXTRA= run "--sandbox bwrap -p hi" --sandbox bwrap -p hi
EXTRA= run "-s=bwrap -p hi" -s=bwrap -p hi
EXTRA= run "--sandbox BWRAP -p hi" --sandbox BWRAP -p hi
EXTRA= run "sandbox --sandbox bwrap" sandbox --sandbox bwrap
EXTRA= run "-p hi -- --sandbox bwrap" -p hi -- --sandbox bwrap
EXTRA= run "--debug mcp add -s project srv npx -y foo" --debug mcp add -s project srv npx -y foo
EXTRA= run "mcp add -s project srv npx -y foo" mcp add -s project srv npx -y foo
EXTRA= run "--sandbox=sandbox-exec mcp list" --sandbox=sandbox-exec mcp list
EXTRA= run "--sandbox sandbox-exec mcp list" --sandbox sandbox-exec mcp list
EXTRA= run "--sandbox=false mcp list" --sandbox=false mcp list
EXTRA= run "mcp list" mcp list
EXTRA= run "--sandbox 'fix the bug' (old form)" --sandbox "fix the bug"
EXTRA= run "-s 'fix the bug' (old form)" -s "fix the bug"
EXTRA= run "--sandbox -p hi" --sandbox -p hi
EXTRA= run "--sandbox=true -p hi" --sandbox=true -p hi
EXTRA= run "-p hi -s" -p hi -s
EXTRA= run "-p hi --sandbox podman" -p hi --sandbox podman
