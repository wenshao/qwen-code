#!/usr/bin/env bash
# Do the SIBLING tests — the ones that already use the adaptive waitFor(...,8000)
# gate this PR adopts — survive the same fork-latency probe? Three of them went
# red in run 33268028550 alongside the test this PR fixes.
set -uo pipefail
SRC=/rig/src; OUT=/out; mkdir -p "$OUT"
declare -A P=(
  [T01_two_patch_calls]='PATCHes the same comment on every tick with growing elapsed time'
  [T16_hermetic_pins]='pins gh hermetically for every tick'
  [T18_inflight_stamp]='stamps each tick in flight around the gh call'
  [T17_mint_skip_AFTER]='skips the tick on a failed config mint'
)
for lat in "$@"; do
  for name in T01_two_patch_calls T16_hermetic_pins T18_inflight_stamp T17_mint_skip_AFTER; do
    work="$(mktemp -d /tmp/sib.XXXXXX)"
    cp "$SRC/autofix-status-heartbeat.sh" "$work/autofix-status-heartbeat.sh"
    cp "$SRC/after.test.mjs" "$work/autofix-status-heartbeat.test.mjs"
    PATH_ORIG="$PATH"
    if [ "$lat" != "0" ]; then
      bash /rig/make-shims.sh "$work/shims" "$lat" > /dev/null
      export PATH="$work/shims:$PATH_ORIG"
    else
      export PATH="$PATH_ORIG"
    fi
    log="$OUT/${name}.lat${lat}.log"
    start="${EPOCHREALTIME}"
    node --test --test-concurrency=1 --test-name-pattern="${P[$name]}" \
      "$work/autofix-status-heartbeat.test.mjs" > "$log" 2>&1
    status=$?
    end="${EPOCHREALTIME}"
    dur="$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.2f", b-a}')"
    verdict=$([ $status -eq 0 ] && echo PASS || echo FAIL)
    echo "SIB test=${name} latency=${lat}s verdict=${verdict} wall=${dur}s"
    echo "SIB test=${name} latency=${lat}s verdict=${verdict} wall=${dur}s" >> "$OUT/siblings.txt"
    export PATH="$PATH_ORIG"
    rm -rf "$work"
  done
done
