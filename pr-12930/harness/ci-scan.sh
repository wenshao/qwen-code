#!/bin/bash
# Validated, retried log scan. res-<jid>.txt = "#OK <bytes>" + matching lines.
cd /root/verify/pr12930/ci/hist
fetch() {
  jid=$1
  [ -s "res-$jid.txt" ] && return
  for attempt in 1 2 3 4; do
    tmp=$(mktemp -p . raw-$jid.XXXX)
    timeout 240 gh api "repos/QwenLM/qwen-code/actions/jobs/$jid/logs" > "$tmp" 2>/dev/null
    sz=$(stat -c %s "$tmp")
    if [ "$sz" -gt 20000 ] && grep -q "##\[group\]" "$tmp" && grep -q "Cleaning up orphan processes\|Post job cleanup\|Complete job" "$tmp"; then
      { echo "#OK $sz"; sed 's/\x1b\[[0-9;]*m//g' "$tmp" | grep -E "child-crash recovery|qwen-serve-streaming.test.ts \("; } > "res-$jid.tmp"
      mv "res-$jid.tmp" "res-$jid.txt"; rm -f "$tmp"; return
    fi
    rm -f "$tmp"; sleep $((attempt * 5))
  done
  echo "$jid" >> failed-fetch.txt
}
export -f fetch
cut -f1 scanjobs-ordered.tsv | xargs -P 12 -I{} bash -c 'fetch {}'
echo SCAN_DONE
