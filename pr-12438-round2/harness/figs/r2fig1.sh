#!/usr/bin/env bash
# R2 figure 1: are the round-1 findings closed at 4ba99cf59a? Every value is read from logs/.
H=/root/verify/pr12438-r2-harness; L=$H/logs; R1=/root/verify/pr12438-harness/logs
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; RD=$'\e[31m'; D=$'\e[2m'; X=$'\e[0m'
strip() { sed -E 's/\x1b\[[0-9;]*m//g'; }
v() { strip < "$1" | command grep -E "^ +(ok|BUG) +$2 " | head -1 | awk '{print $1}'; }
tag() { [ "$1" = ok ] && printf "${G}%-5s${X}" ok || printf "${RD}%-5s${X}" BUG; }
echo "${B}${C}PR #12438 round 2 — are the round-1 findings closed at 4ba99cf59a?${X}"
echo "${D}Same external probes (compiled into the module package) run against both heads; PR trees untouched.${X}"
echo
echo "${B}A. ServiceProbe rows${X}                                             ${D}054159f (R1)   4ba99cf59a (R2)${X}"
row() { printf "  %-10s %-52s %s          %s\n" "$1" "$2" "$(tag $(v $R1/probe-head.log "$1"))" "$(tag $(v $L/probe-head.log "$1"))"; }
row S1-a  "finding 1a: one provision per binding"
row S1-c  "finding 1a: durable lease not swapped"
row S1-d  "finding 1a: all Sessions route via one lease"
row S2-a  "R1-2: interrupted DISPATCHING settles after retry"
row S2-b  "R1-2: Session releasable afterwards"
row S2b-stall  "R1-2: stall > lease, no fault, then retry"
row S2b-cancel "R1-2: fault, then cancel instead of retry"
row S2b-late   "R1-2: result after lapse -> UNKNOWN on retry"
row S2b-commit "R1-2: EXECUTING committed then throw"
c1=$(strip < $R1/probe-head.log | command grep 'it returned after' | sed -E 's/.*returned after ([0-9]+) ms with ([A-Z_/a-z]+).*calls=([0-9]+).*/\1 ms, cancel sent: \3/')
c2=$(strip < $L/probe-head.log | command grep 'it returned after' | sed -E 's/.*returned after ([0-9]+) ms with ([A-Z_/a-z]+).*calls=([0-9]+).*/\1 ms, cancel sent: \3/')
printf "  %-10s %-52s ${RD}%-14s${X} ${G}%s${X}\n" "S10" "R1-18: cancel latency behind a blocking execute()" "${c1%%,*}" "${c2%%,*}"
printf "  %-10s %-52s ${RD}%-14s${X} ${G}%s${X}\n" "" "        physical cancel sent while execute() blocks" "${c1##*: }" "${c2##*: }"
e1=$(strip < $R1/probe-head.log | command grep 'Runtime says settled' | sed -E 's/.*"stopped" +//; s/\(.*//')
e2=$(strip < $L/probe-head.log | command grep 'Runtime says settled' | sed -E 's/.*RuntimeBrokerException\(([0-9]+ [a-z_]+).*/\1/')
printf "  %-10s %-52s ${RD}%-14s${X} ${G}%s${X}\n" "S3" "R1-6: invalid settled cancel result" "untyped IAE" "$e2"
echo
echo "${B}B. Finding 1 under real concurrency${X}  ${D}(RaceStress: per round a fresh workspace, 1 starter + 16 concurrent acquire, no sequencing hooks;${X}"
echo "  ${D}cells = rounds provisioned twice / false runtime_reconciliation_required; both heads re-run today, logs/race-final.log)${X}"
F=$L/race-final.log
cell() { strip < $F | awk -v a="## arm=$1 $2" 'index($0,a)==1{f=1;next} /^## arm=/{f=0} f&&/double-provisioned/' | sed -E 's/.*rounds=([0-9]+) .*double-provisioned rounds=([0-9]+) +acquire errors=([0-9]+).*/\2\/\1 \3/' | head -1; }
mem() { for i in 1 2 3; do cell $1 "memory run $i"; done | awk '{split($1,a,"/"); d=d (d==""?"":",") a[1]; e=e (e==""?"":",") $2; t=a[2]} END{print "{"d"}/"t"  {"e"}"}'; }
printf "  %-48s ${D}%-26s %s${X}\n" "backend" "054159f" "4ba99cf59a"
printf "  %-48s ${RD}%-26s${X} ${G}%s${X}\n" "in-memory (3 runs each)" "$(mem r1)" "$(mem r2)"
printf "  %-48s ${RD}%-26s${X} ${G}%s${X}\n" "JDBC on H2 2.3.232 (MODE=MySQL)" "$(cell r1 h2)" "$(cell r2 h2)"
printf "  %-48s ${D}%-26s${X} ${G}%s${X}\n" "JDBC on MySQL 8.4.11" "$(cell r1 'mysql unpaused')" "$(cell r2 'mysql unpaused')"
printf "  %-48s ${RD}%-26s${X} ${G}%s${X}\n" "JDBC on MySQL 8.4.11, 5 ms pause after the read" "$(cell r1 "mysql JOPTS='-DpauseAfterReadMicros=5000'")" "$(cell r2 "mysql JOPTS='-DpauseAfterReadMicros=5000'")"
echo "  ${D}(on MySQL, findOrCreate's SELECT … FOR UPDATE narrows the window; the pause models a caller descheduled right after its read)${X}"
echo
echo "${B}C. Round-1 tests and renewal probes${X}"
f=$(command grep -c '^\[ERROR\]   RuntimeBrokerServiceRaceTest' $R1/negctl-head-plus-tests.log)
p=$(command grep -E 'Tests run:.*RaceTest' $L/raceplus-r2.log | sed -E 's/.*Tests run: ([0-9]+), Failures: ([0-9]+), Errors: ([0-9]+).*/\1 \2 \3/')
set -- $p
printf "  %-62s ${RD}%-14s${X} ${G}%s${X}\n" "6 tests proposed in round 1 (RuntimeBrokerServiceRaceTest)" "$f/6 fail" "$(( $1 - $2 - $3 ))/$1 pass"
rb() { strip < "$1" | command grep -E "^ +(ok|BUG) +$2 " | sed -E "s/^ +(ok|BUG) +$2 +//"; }
printf "  %-62s ${RD}%-14s${X} ${G}%s${X}\n" "R2-B one transient renewDispatch exception, execute > lease" "$(rb $L/r2probe-r1head.log R2-B | sed -E 's/after the result arrived: ([A-Z]+).*/\1/')" "$(rb $L/r2probe-head.log R2-B | sed -E 's/after the result arrived: ([A-Z/a-z]+);.*/\1/')"
printf "  %-62s ${RD}%-14s${X} ${G}%s${X}\n" "R2-C lapse seen by the renewal task, no caller retry" "$(rb $L/r2probe-r1head.log R2-C | sed -E 's/400 ms after the jump: ([A-Z]+);.*/\1/')" "$(rb $L/r2probe-head.log R2-C | sed -E 's/400 ms after the jump: ([A-Z]+);.*/\1/')"
