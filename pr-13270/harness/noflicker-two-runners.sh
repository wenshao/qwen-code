#!/usr/bin/env bash
# Two "runners" on one host run the real offline no-flicker gate at the same
# time, each with its own runner.temp-style OUT (the 9d0ff23 shape).
set -u
SP="$1"; WT=/root/git/qwen-code-pr13270
export PATH=/root/.bun/bin:$PATH
rm -rf "$SP/noflicker"; mkdir -p "$SP/noflicker/runner-A/_temp" "$SP/noflicker/runner-B/_temp"
cd "$WT"
for r in A B; do
  ( OUT="$SP/noflicker/runner-$r/_temp/opentui-noflicker-out" bash scripts/tui-parity/accept-noflicker.sh > "$SP/noflicker/$r.log" 2>&1; echo "runner-$r exit=$?" >> "$SP/noflicker/$r.log" ) &
done
wait
