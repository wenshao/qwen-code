#!/bin/bash
# Round 3 Workspace recovery matrix: base (wt-base) vs head (wt-pr), headless `-p hi`, fake model unreachable
# (exit 1 after a successful start). Prints file state before/after for the workspace file and any outside target.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4bc58a7c-2b06-4022-98dd-e3f296888d77/scratchpad
MAL='{"ui": {"hideTips": true, "secret": "AKIA-EXAMPLE-outside-bytes",'
VALID='{"ui": {"hideTips": true}}'
st() { [ -e "$1" ] || { echo "absent"; return; }; printf '%s %s %s' "$(stat -f '%Sp' "$1")" "$(shasum -a 256 "$1" | cut -c1-8)" "$(head -c 24 "$1" | tr -d '\n')"; }
fresh() { F=$1; chmod -R u+w "$F" 2>/dev/null; rm -rf "$F"; mkdir -p "$F/home/.qwen" "$F/ws" "$F/outside"
  echo '{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"fake-model"}}' > "$F/home/.qwen/settings.json"; }
launch() { "$S/tui-run.sh" "$1" "$2" -p hi 2>&1 </dev/null; }
show() { echo "    ws/.qwen: $(ls -la "$1/ws/.qwen" 2>/dev/null | tail -n +4 | awk '{print $1" "$9$10$11}' | tr '\n' ';')"; }
for arm in base pr; do
  echo "################ arm=$arm"
  # E1: read-only regular settings.json, three launches
  F=$S/w3-$arm-rofile; fresh $F; mkdir -p $F/ws/.qwen; printf '%s\n' "$MAL" > $F/ws/.qwen/settings.json; chmod 444 $F/ws/.qwen/settings.json
  for n in 1 2 3; do out=$(launch $arm $F); rc=$?; echo "E1 read-only file launch $n: exit=$rc :: $(echo "$out" | grep -v '^$' | head -1 | cut -c1-110 | sed "s|$S/|\$S/|g")"; done; show $F
  # R3-1a: symlink to a malformed file outside the workspace
  F=$S/w3-$arm-symlink; fresh $F; mkdir -p $F/ws/.qwen; printf '%s\n' "$MAL" > $F/outside/shared.json; ln -s $F/outside/shared.json $F/ws/.qwen/settings.json
  before=$(st $F/outside/shared.json); out=$(launch $arm $F); rc=$?
  echo "R3-1 symlink->outside: exit=$rc :: $(echo "$out" | grep -v '^$' | head -1 | cut -c1-120 | sed "s|$S/|\$S/|g")"
  echo "    outside before: $before"; echo "    outside after:  $(st $F/outside/shared.json)"; echo "    ws copy: $(st $F/ws/.qwen/settings.json.corrupted)"
  # R3-1b: hard link shared with an outside file
  F=$S/w3-$arm-hardlink; fresh $F; mkdir -p $F/ws/.qwen; printf '%s\n' "$MAL" > $F/outside/shared.json; ln $F/outside/shared.json $F/ws/.qwen/settings.json
  out=$(launch $arm $F); rc=$?
  echo "R3-1 hard link (nlink 2): exit=$rc :: $(echo "$out" | grep -v '^$' | head -1 | cut -c1-120 | sed "s|$S/|\$S/|g")"
  echo "    outside after: $(st $F/outside/shared.json)"; echo "    ws copy: $(st $F/ws/.qwen/settings.json.corrupted)"
  # R3-1c: the .qwen directory itself is a symlink to an outside directory
  F=$S/w3-$arm-dirlink; fresh $F; mkdir -p $F/outside/qdir; printf '%s\n' "$MAL" > $F/outside/qdir/settings.json; ln -s $F/outside/qdir $F/ws/.qwen
  out=$(launch $arm $F); rc=$?
  echo "R3-1 symlinked .qwen dir: exit=$rc :: $(echo "$out" | grep -v '^$' | head -1 | cut -c1-120 | sed "s|$S/|\$S/|g")"
  echo "    outside after: $(st $F/outside/qdir/settings.json)"; echo "    outside copy: $(st $F/outside/qdir/settings.json.corrupted)"
  # control: valid JSON through a symlink keeps working
  F=$S/w3-$arm-validlink; fresh $F; mkdir -p $F/ws/.qwen; printf '%s\n' "$VALID" > $F/outside/shared.json; ln -s $F/outside/shared.json $F/ws/.qwen/settings.json
  out=$(launch $arm $F); rc=$?
  echo "control valid JSON via symlink: exit=$rc :: $(echo "$out" | grep -v '^$' | head -1 | cut -c1-90) :: outside $(st $F/outside/shared.json)"
  # mode of the preserved copy for a private 0600 file
  F=$S/w3-$arm-mode; fresh $F; mkdir -p $F/ws/.qwen; printf '%s\n' "$MAL" > $F/ws/.qwen/settings.json; chmod 600 $F/ws/.qwen/settings.json
  out=$(launch $arm $F); rc=$?
  echo "0600 original: exit=$rc :: settings $(st $F/ws/.qwen/settings.json) :: copy $(st $F/ws/.qwen/settings.json.corrupted)"
done
