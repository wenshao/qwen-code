#!/bin/bash
# Usage: setup-deps.sh <worktree> <donor>
set -euo pipefail
WT="$1"; DONOR="$2"

link_dir() {  # link_dir <donor_nm> <target_nm>
  local src="$1" dst="$2"
  [ -d "$src" ] || return 0
  mkdir -p "$dst"
  for entry in "$src"/* "$src"/.bin; do
    [ -e "$entry" ] || continue
    local name; name=$(basename "$entry")
    [ "$name" = "@qwen-code" ] && continue
    if [ "$name" = ".bin" ]; then
      mkdir -p "$dst/.bin"
      for b in "$entry"/*; do [ -e "$b" ] || continue; ln -sfn "$b" "$dst/.bin/$(basename "$b")"; done
      continue
    fi
    if [[ "$name" == @* ]]; then
      # scope dir: real dir of per-entry symlinks
      mkdir -p "$dst/$name"
      for s in "$entry"/*; do [ -e "$s" ] || continue; ln -sfn "$s" "$dst/$name/$(basename "$s")"; done
      continue
    fi
    ln -sfn "$entry" "$dst/$name"
  done
}

link_dir "$DONOR/node_modules" "$WT/node_modules"

# @qwen-code scope -> this worktree's own packages (relative targets)
mkdir -p "$WT/node_modules/@qwen-code"
declare -A MAP
while IFS=$'\t' read -r name dir; do MAP["$name"]="$dir"; done < <(
  cd "$WT" && for pj in packages/*/package.json packages/channels/*/package.json; do
    [ -f "$pj" ] || continue
    n=$(node -p "require('./$pj').name" 2>/dev/null) || continue
    printf '%s\t%s\n' "$n" "$(dirname "$pj")"
  done
)
for n in "${!MAP[@]}"; do
  short="${n#@qwen-code/}"
  rel=$(python3 -c "import os,sys;print(os.path.relpath(sys.argv[1], sys.argv[2]))" "$WT/${MAP[$n]}" "$WT/node_modules/@qwen-code")
  ln -sfn "$rel" "$WT/node_modules/@qwen-code/$short"
done

# nested per-package node_modules
for p in "$DONOR"/packages/*/node_modules "$DONOR"/packages/channels/*/node_modules; do
  [ -d "$p" ] || continue
  sub=${p#"$DONOR"/}
  link_dir "$p" "$WT/$sub"
done
echo "deps linked for $WT"
