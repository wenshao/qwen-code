#!/bin/bash
# Per-entry node_modules symlink farm (no npm ci). $1 = target worktree, $2 = donor
set -u
WT="$1"; DONOR="$2"
link_dir() {
  local dst="$1" src="$2"
  [ -d "$src" ] || return 0
  mkdir -p "$dst"
  for entry in "$src"/* "$src"/.bin; do
    [ -e "$entry" ] || continue
    local name; name=$(basename "$entry")
    if [ "$name" = ".bin" ]; then
      mkdir -p "$dst/.bin"
      for b in "$entry"/*; do [ -e "$b" ] || continue; ln -sfn "$b" "$dst/.bin/$(basename "$b")"; done
      continue
    fi
    if [ "$name" = "@qwen-code" ]; then continue; fi
    if [[ "$name" == @* ]]; then
      mkdir -p "$dst/$name"
      for s in "$entry"/*; do [ -e "$s" ] || continue; ln -sfn "$s" "$dst/$name/$(basename "$s")"; done
      continue
    fi
    ln -sfn "$entry" "$dst/$name"
  done
}
link_dir "$WT/node_modules" "$DONOR/node_modules"
# @qwen-code scope must point at THIS worktree's packages
mkdir -p "$WT/node_modules/@qwen-code"
for pj in "$WT"/packages/*/package.json "$WT"/packages/channels/*/package.json; do
  [ -e "$pj" ] || continue
  d=$(dirname "$pj"); n=$(node -p "require('$pj').name" 2>/dev/null) || continue
  case "$n" in @qwen-code/*) ln -sfn "$d" "$WT/node_modules/${n}";; esac
done
for p in "$WT"/packages/*; do
  [ -d "$p" ] || continue
  link_dir "$p/node_modules" "$DONOR/packages/$(basename "$p")/node_modules"
done
echo "done $WT"
