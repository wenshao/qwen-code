#!/usr/bin/env bash
# Figure 5: non-blocking observations for the adapter slices. All values from logs/probe-head.log.
H=/root/verify/pr12438-harness; L=$H/logs
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; RD=$'\e[31m'; Y=$'\e[33m'; D=$'\e[2m'; X=$'\e[0m'
strip() { sed -E 's/\x1b\[[0-9;]*m//g'; }
sec() { awk -v a="$1" -v b="$2" '$0 ~ a {p=1;next} $0 ~ b {p=0} p' $L/probe-head.log | strip; }
echo "${B}${C}PR #12438 @ 054159f — observations for the HTTP adapter / provider slices (non-blocking)${X}"
echo
echo "${B}A. How the public API reports failures${X}  ${D}(throw = exception escapes the call; stage = failed CompletionStage; typed = RuntimeBrokerException)${X}"
sec '== S3' '== S4' | while IFS= read -r l; do
  case "$l" in *stage/typed*) echo "  ${G}${l#  }${X}";; *untyped*|*throw/*) echo "  ${Y}${l#  }${X}";; *) echo "  ${D}${l#  }${X}";; esac
done
echo
echo "${B}B. UNKNOWN keeps the Session unreleasable in this slice${X}"
sec '== S6' '== S7' | sed 's/^  */  /'
echo
echo "${B}C. Transport calls run while the Session monitor is held${X}"
sec '== S10' '== S11' | sed 's/^  */  /'
echo
echo "${B}D. What warm() returns to its caller${X}"
sec '== S11' '== S12' | sed 's/^  */  /'
echo
echo "${B}E. Stale dispatch owner cannot settle${X}  ${D}(doc acceptance criterion the triage review flagged as untested)${X}"
sec '== S12' 'PROBE' | sed 's/^  */  /'
