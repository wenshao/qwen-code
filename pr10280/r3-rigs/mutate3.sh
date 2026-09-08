#!/bin/bash
# PR #10280 round-3 mutation matrix.
# Usage: mutate3.sh <id> <python-patch-file>
set -u
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/047abc54-11c9-4c4a-9481-572804010d8d/scratchpad
W=$S/wt3
SRC=$W/packages/core/src/core/coreToolScheduler.ts
TST=$W/packages/core/src/core/coreToolScheduler.test.ts
ID=$1
PATCH=$2

cp "$SRC" "$S/.bak.src"
cp "$TST" "$S/.bak.tst"
cd "$W" || exit 1
python3 "$PATCH" "$SRC" "$TST"
rc=$?
if [ $rc -ne 0 ]; then
  echo "$ID PATCH_FAILED"
  cp "$S/.bak.src" "$SRC"; cp "$S/.bak.tst" "$TST"
  exit 1
fi
NODE_OPTIONS=--max-old-space-size=8192 npm -w @qwen-code/qwen-code-core test -- src/core/coreToolScheduler.test.ts > "$S/mut-$ID.log" 2>&1
line=$(grep -E "^ +Tests +" "$S/mut-$ID.log" | tail -1)
echo "$ID  ${line:-NO_SUMMARY}"
grep -E "^ +× |FAIL " "$S/mut-$ID.log" | sed 's/^/     /' | head -8
cp "$S/.bak.src" "$SRC"; cp "$S/.bak.tst" "$TST"
