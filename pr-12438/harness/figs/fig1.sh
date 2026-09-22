#!/usr/bin/env bash
# Figure 1: finding 1 — the PROVISIONING -> READY edge. All values come from logs/.
H=/root/verify/pr12438-harness; L=$H/logs
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; RD=$'\e[31m'; D=$'\e[2m'; X=$'\e[0m'
strip() { sed -E 's/\x1b\[[0-9;]*m//g'; }
echo "${B}${C}PR #12438 @ 054159f — finding 1: concurrent acquire across the PROVISIONING → READY edge${X}"
echo "${D}ServiceProbe S1 (external probe in the module package, in-memory repositories): caller T2 reads the binding while it is PROVISIONING,${X}"
echo "${D}provisioning #1 then completes and caller T1 acquires rs-1; T2 continues with its PROVISIONING read and acquires rs-2.${X}"
echo
for arm in head fix; do
  [ $arm = head ] && echo "${B}A. 054159f (PR head)${X}" || echo "${B}B. with the suggested patch (+21/−1)${X}"
  command grep -E 'S1-[a-d]' $L/probe-$arm.log | strip | sed -E 's/binding [0-9a-f-]{36}/binding <id>/' | while IFS= read -r l; do
    case "$l" in *BUG*) echo "  ${RD}${l# }${X}";; *) echo "  ${G}${l# }${X}";; esac
  done
  echo
done
echo "${B}C. No hooks at all — real threads only${X}  ${D}(RaceStress: per round a fresh workspace, 1 starter + 16 concurrent acquire, provisioning completes at a random µs)${X}"
printf "  ${D}%-44s %-29s %-24s${X}\n" "repository backend" "head: rounds provisioned 2x" "head: false reconciliation" 
row() { # label headfile fixfile
  hd=$(command grep -hE 'double-provisioned' "$2" | strip); fx=$(command grep -hE 'double-provisioned' "$3" | strip)
  hdd=$(echo "$hd" | sed -E 's/.*rounds=([0-9]+) .*double-provisioned rounds=([0-9]+).*acquire errors=([0-9]+).*/\2\/\1 \3/')
  fxd=$(echo "$fx" | sed -E 's/.*rounds=([0-9]+) .*double-provisioned rounds=([0-9]+).*acquire errors=([0-9]+).*/\2\/\1 \3/')
  set -- "$1" $hdd $fxd
  c1=$G; [ "${2%%/*}" != 0 ] && c1=$RD; c2=$G; [ "$3" != 0 ] && c2=$RD
  printf "  %-44s %s%-29s%s %s%-24s%s ${D}patched: %s rounds, %s errors${X}\n" "$1" "$c1" "$2" "$X" "$c2" "$3" "$X" "$4" "$5"
}
split() { awk -v want="$2" 'BEGIN{p=0} /^## arm=/{p=($0 ~ want)} p' "$1"; }
split $L/race-3000.log 'arm=sdk-java$' | command grep -B0 -A1 memory > /tmp/.h1; split $L/race-3000.log 'arms/fix' | command grep -A1 memory > /tmp/.f1
split $L/race-3000.log 'arm=sdk-java$' | command grep -A1 'h2' > /tmp/.h2; split $L/race-3000.log 'arms/fix' | command grep -A1 'h2' > /tmp/.f2
split $L/race-mysql-pause.log 'arm=sdk-java$' > /tmp/.h4; split $L/race-mysql-pause.log 'arms/fix' > /tmp/.f4
row "in-memory repositories" /tmp/.h1 /tmp/.f1
row "JDBC on H2 2.3.232, MODE=MySQL" /tmp/.h2 /tmp/.f2
m1=$(command grep -h double $L/race-mysql-head-1000.log | strip | sed -E 's/.*double-provisioned rounds=([0-9]+).*acquire errors=([0-9]+).*/\1 \2/')
m2=$(command grep -h double $L/race-mysql-head-400-spin30ms.log | strip | sed -E 's/.*double-provisioned rounds=([0-9]+).*acquire errors=([0-9]+).*/\1 \2/')
mf=$(command grep -h double $L/race-mysql-fix-1000.log | strip | sed -E 's/.*double-provisioned rounds=([0-9]+).*acquire errors=([0-9]+).*/\1 \2/')
set -- $m1 $m2 $mf
printf "  %-44s %s%-29s%s %s%-24s%s ${D}patched: %s/1000 rounds, %s errors${X}\n" "JDBC on MySQL 8.4.11" "$G" "$1/1000 + $3/400" "$X" "$G" "$(( $2 + $4 ))" "$X" "$5" "$6"
echo "  ${D}  (MySQL: findOrCreate holds the row lock, so the read serialises with the READY write — the window is too narrow on this box)${X}"
row "JDBC on MySQL 8.4.11, caller paused 5 ms*" /tmp/.h4 /tmp/.f4
echo "  ${D}* the pause models a caller descheduled (GC safepoint, CPU contention) right after it read a PROVISIONING row${X}"
