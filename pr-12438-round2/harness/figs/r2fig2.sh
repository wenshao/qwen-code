#!/usr/bin/env bash
# R2 figure 2: what round 2 adds. Every value is read from logs/.
H=/root/verify/pr12438-r2-harness; L=$H/logs
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; RD=$'\e[31m'; Y=$'\e[33m'; D=$'\e[2m'; X=$'\e[0m'
strip() { sed -E 's/\x1b\[[0-9;]*m//g'; }
line() { strip < "$1" | command grep -E "^ +(ok|BUG) +$2 " | sed -E "s/^ +(ok|BUG) +$2 +//"; }
calls() { line "$1" "$2" | sed -E 's/.*cancel#1 -> ([A-Z_]+).*calls=([0-9]+); cancel#2 -> ([A-Z_]+).*calls=([0-9]+)/\1 \2 \4/'; }
echo "${B}${C}PR #12438 round 2 — new in 4ba99cf59a: cancel after a dispatch lease lapsed${X}"
echo "${D}R2Probe (in-memory repositories, injected clock). execute() is still running in the owning process; the lease lapses before the next${X}"
echo "${D}renewal tick (renewal runs every lease/3 of wall time). The caller then cancels twice, and finally the Tool call completes.${X}"
echo
echo "${B}A. Is the physical cancel sent?${X}"
printf "  ${D}%-34s %-24s %-24s %s${X}\n" "" "054159f (R1 head)" "4ba99cf59a (PR head)" "PR head + patch"
for k in live lapse; do
  set -- $(calls $L/r2probe-r1head.log "R2-A $k"); a="$1 / sent ${2}, ${3}"
  set -- $(calls $L/r2probe-head.log "R2-A $k"); b="$1 / sent ${2}, ${3}"; bc=$G; [ "$2" = 0 ] && bc=$RD
  set -- $(calls $L/r2probe-fix.log "R2-A $k"); c="$1 / sent ${2}, ${3}"
  [ $k = live ] && lbl="lease live (control)" || lbl="lease lapsed, execute running"
  printf "  %-34s ${G}%-24s${X} ${bc}%-24s${X} ${G}%s${X}\n" "$lbl" "${a/CANCEL_REQUESTED/CANCEL_REQ}" "${b/CANCEL_REQUESTED/CANCEL_REQ}" "${c/CANCEL_REQUESTED/CANCEL_REQ}"
done
echo "  ${D}(state returned by cancel / transport.cancel calls after cancel #1, #2)${X}"
t=$(strip < $L/r2probe-head.log | command grep -A1 'R2-A lapse' | tail -1 | sed -E 's/^ +then //')
echo "  ${D}PR head afterwards: $t${X}"
echo "  ${Y}→${X} the caller is told CANCEL_REQUESTED, but nothing reaches the Runtime. The record is fenced to UNKNOWN later: by the next"
echo "    renewal tick, or, if the call completes first, by the next same-key call. Nothing executes twice."
echo
echo "${B}B. R1-2's third symptom is still open${X}  ${D}(the Runtime confirms settled/cancelled after the lease lapsed)${X}"
printf "  %-24s ${RD}%s${X}\n" "054159f" "$(line $L/r2probe-r1head.log R2-D | sed -E 's/; stored.*//; s/async RuntimeBrokerException/RBE/')"
printf "  %-24s ${RD}%s${X}\n" "4ba99cf59a" "$(line $L/r2probe-head.log R2-D | sed -E 's/; stored.*//; s/async RuntimeBrokerException/RBE/')"
printf "  %-24s ${G}%s${X}\n" "PR head + patch" "$(line $L/r2probe-fix.log R2-D | sed -E 's/async RuntimeBrokerException/RBE/')"
echo
echo "${B}C. The two proposed tests (added to RuntimeBrokerServiceTest), negative control${X}"
strip < $L/negctl-r2-tests.log | command grep -E '^\[ERROR\]   ' | sed -E 's/^\[ERROR\]   RuntimeBrokerServiceTest\.//; s/ » Completion com.alibaba.qwen.code.runtimebroker.RuntimeBrokerException: / » 409 /' | while IFS= read -r l; do echo "  ${RD}FAIL on PR head${X}  ${l:0:120}"; done
p=$(strip < $L/gate-fresh-patch-jdk21.log | command grep -E 'Tests run: [0-9]+, F.*[0-9]$' | tail -1 | sed -E 's/^\[INFO\] //'); v=$(strip < $L/gate-fresh-patch-jdk21.log | command grep -o 'You have [0-9]* Checkstyle violations')
echo "  ${G}pass with patch${X}   fresh git apply on 4ba99cf59a, eclipse-temurin:21-jdk: $p · $v"
echo
echo "${B}D. Pre-existing, first reported here${X}  ${D}(BindingRenewal still drops its claim on one transient exception; DispatchRenewal no longer does)${X}"
printf "  %-24s ${Y}%s${X}\n" "054159f / 4ba99cf59a" "$(line $L/r2probe-head.log R2-E | sed -E 's/async RuntimeBrokerException/RBE/g')"
