#!/usr/bin/env bash
# Runs the publish step body verbatim (bash -eo pipefail like Actions' shell: bash) against the gh stand-in.
set -uo pipefail
P=/root/pr14176-rig/publish
V=0.0.0-pr.14176
export GH_REPO=QwenLM/qwen-code GH_TOKEN=stub RELEASE_TAG=managed-agent-reference-v$V RELEASE_VERSION=$V GITHUB_SHA=dc6ea3b4601707ceef4b41f0c064fa490b13a2da
run() { # name step digestmode tamper sizelie extra
  local name=$1 step=$2; local W=$P/work/$name; rm -rf $W; mkdir -p $W/state; ln -s /root/pr14176-rig/out-a $W/release-assets
  ( cd $W && export STATE=$W/state DIGEST_MODE=$3 TAMPER=$4 SIZE_LIE=$5 EXTRA_ASSET=$6 PATH=$P/bin:$PATH
    bash --noprofile --norc -eo pipefail $P/publish-step-$step.sh > $W/out.log 2>&1; echo $? > $W/exit )
  local downloads; downloads=$(grep -c 'octet-stream' $W/state/calls.log || true)
  printf '%-34s step=%-13s exit=%s tag=%-3s published=%-3s downloads=%s  %s\n' "$name" "$step" "$(cat $W/exit)" \
    "$([[ -f $W/state/tag-created ]] && echo yes || echo no)" "$([[ -f $W/state/published ]] && echo yes || echo no)" "$downloads" \
    "$(grep -o '::error::.*' $W/out.log | head -1)"
}
A=qwen-managed-agent-reference-$V.tar.gz
run S1-honest-digest            head present "" "" ""
run S2-honest-no-digest         head absent  "" "" ""
run S3-tampered-archive         head present "$A" "" ""
run S4-tampered-archive-nodig   head absent  "$A" "" ""
run S5-tampered-sums            head present SHA256SUMS.txt "" ""
run S6-size-mismatch            head present "" "$A" ""
run S7-extra-asset              head present "" "" 1
run S8-PREV-tampered-archive    prev-9cf063f0 present "$A" "" ""
run S9-PREV-honest              prev-9cf063f0 present "" "" ""
echo; echo "S1 call sequence:"; sed 's/^/  /' $P/work/S1-honest-digest/state/calls.log | cut -c1-150
echo "S1 tag: $(cat $P/work/S1-honest-digest/state/tag-created)"
