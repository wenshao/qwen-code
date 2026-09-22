#!/usr/bin/env bash
# Figure 2: finding 2 — Tool executions that no dispatcher serves any more.
H=/root/verify/pr12438-harness; L=$H/logs
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; RD=$'\e[31m'; D=$'\e[2m'; X=$'\e[0m'
strip() { sed -E 's/\x1b\[[0-9;]*m//g'; }
paint() { while IFS= read -r l; do case "$l" in *BUG*) echo "  ${RD}${l# }${X}";; *" ok "*) echo "  ${G}${l# }${X}";; *) echo "  ${D}${l#  }${X}";; esac; done; }
echo "${B}${C}PR #12438 @ 054159f — finding 2: executions that no dispatcher serves any more (Session release stays busy)${X}"
echo "${D}ServiceProbe S2: the Tool execution repository throws once on the DISPATCHING → EXECUTING compare-and-set; no physical execute was sent.${X}"
echo "${D}Then: retry the same key, let the dispatch lease expire, retry, cancel, release.${X}"
echo
for arm in head fix; do
  [ $arm = head ] && echo "${B}A. 054159f (PR head)${X}" || echo "${B}B. with the suggested patch${X}"
  awk '/== S2 /{p=1;next} /== S2b/{p=0} p' $L/probe-$arm.log | strip | paint
  echo
done
echo "${B}C. The same class without a repository fault, and the other exits${X}  ${D}(S2b; stall = a pause longer than the dispatch lease, shipped in-memory repository)${X}"
for arm in head fix; do
  [ $arm = head ] && echo "  ${B}054159f${X}" || echo "  ${B}patched${X}"
  awk '/== S2b/{p=1;next} /== S3/{p=0} p' $L/probe-$arm.log | strip | sed -E 's/^ +first call /             first call /' | paint
done
