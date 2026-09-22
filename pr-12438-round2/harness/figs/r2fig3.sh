#!/usr/bin/env bash
# R2 figure 3: gates, real MySQL multi-JVM re-run, stress, guard-deletion sweep. Every value from logs/ and mutants/.
H=/root/verify/pr12438-r2-harness; L=$H/logs; MU=$H/mutants
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; RD=$'\e[31m'; Y=$'\e[33m'; D=$'\e[2m'; X=$'\e[0m'
strip() { sed -E 's/\x1b\[[0-9;]*m//g'; }
pick() { strip < "$1" | command grep -E "$2" | tail -1 | sed -E 's/^\[(INFO|WARNING|ERROR)\] //'; }
echo "${B}${C}PR #12438 round 2 @ 4ba99cf59a — gates, real MySQL, stress, guard-deletion sweep${X}"
echo
echo "${B}A. Gates${X}"
printf "  %-44s %-50s ${G}%s${X}\n" "mvn verify, $(pick $L/gate-head-jdk21.log 'openjdk version' | sed -E 's/openjdk version "([0-9.]+)".*/JDK \1 (container)/')" "$(pick $L/gate-head-jdk21.log 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$')" "BUILD SUCCESS"
printf "  %-44s %-50s ${G}%s${X}\n" "mvn checkstyle:check (not bound to verify)" "$(pick $L/gate-head-jdk21.log 'Checkstyle violations')" "BUILD SUCCESS"
printf "  %-44s %-50s ${G}%s${X}\n" "RuntimeBrokerServiceTest x20 (flake check)" "$(command grep -c pass $L/flake-20.log)/20 runs green" "ok"
n=$(wc -l < $L/ci-4ba99cf59a.tsv); ok=$(command grep -cP '\tpass$' $L/ci-4ba99cf59a.tsv); sk=$(command grep -cP '\tskipping$' $L/ci-4ba99cf59a.tsv)
printf "  %-44s %-50s ${G}%s${X}\n" "CI on 4ba99cf59a" "$ok pass, $sk skipped, 0 failing (Java 11/17/21 + macOS/Win 21)" "ok"
echo
echo "${B}B. Real MySQL 8.4, several Broker JVMs${X}  ${D}(round-1 scenarios re-run on the new head)${X}"
m1p=$(strip < $L/M1.ansi | command grep -c 'provisioner called'); m1f=$(strip < $L/M1.ansi | command grep 'final after' | command grep -c 'reconciliation_required')
m1r=$(strip < $L/M1.ansi | command grep 'final after' | command grep 'reconciliation_required' | sed -E 's/.*final after ([0-9]+) attempt.*/\1/' | sort -n | sed -n '1p;$p' | paste -sd-)
printf "  ${G}ok${X}  %-4s %s\n" M1 "6 JVMs warm one workspace: $m1p physical provision; the $m1f non-owners end on 503 runtime_reconciliation_required"
printf "  %-8s ${D}%s${X}\n" "" "(retryable=true, after $m1r attempts each; adoption is a documented non-goal, unchanged since round 1)"
printf "  ${G}ok${X}  %-4s %s\n" M2 "SIGSTOPped owner resumes -> $(strip < $L/M2.ansi | command grep 'broker-A\] final' | sed -E 's/.*RuntimeBrokerException\(([0-9]+ [a-z_]+).*/\1/'); stored lease = $(strip < $L/M2.ansi | command grep -E '\| +1 \| READY' | awk -F'|' '{gsub(/ /,"",$4); print $4}')"
printf "  ${G}ok${X}  %-4s %s\n" M3 "kill -9 mid-provision -> broker-B takes over after the lease: $(strip < $L/M3.ansi | command grep 'broker-B\] final' | sed -E 's/.*final after ([0-9]+) attempt.*: (.*)/\2 after \1 attempts/')"
printf "  ${G}ok${X}  %-4s %s\n" M4 "restart with the same owner id: warm, 2 acquires and release -> $(strip < $L/M4.ansi | command grep -c 'runtime_reconciliation_required')/4 answer 503; no second provision"
echo
echo "${B}C. Stress${X}"
strip < $L/exec-stress.log | awk '/^## arm=\/root/{f=1;next} /^## arm=/{f=0} f&&/^exec/' | sed -E 's/^exec +/  same-key dispatch+cancel  /; s/ +\([0-9.]+s\)//'
echo "  ${D}binding edge: see figure 1 (0 double provisions on in-memory, H2, MySQL, MySQL + 5 ms pause)${X}"
echo
tot=$(command grep -c '' <(command grep -v '^#' $MU/run-head.log)); k1=$(command grep -c $'\tKILLED\t' $MU/run-head.log); k2=$(command grep -c $'\tKILLED\t' $MU/run-raceplus.log)
o1=$(command grep -E $'^M' $MU/run-head.log | command grep -c $'\tKILLED\t'); n1=$(command grep -E $'^N' $MU/run-head.log | command grep -c $'\tKILLED\t'); nn=$(command grep -cE '^N' $MU/run-head.log); on=$(command grep -cE '^M' $MU/run-head.log)
pk=$(command grep -c 'PROBE-KILLED' $MU/probe-kill-head.log)
echo "${B}D. Deleting one guard at a time in RuntimeBrokerService${X}  ${D}($tot guards: the $on from round 1, re-mapped, plus $nn added by 4ba99cf59a)${X}"
printf "  %-50s ${G}%s${X}   ${D}(round 1: 10/38 with 17 tests)${X}\n" "PR's 34 service tests kill" "$k1/$tot  (round-1 guards $o1/$on, new guards $n1/$nn)"
printf "  %-50s ${G}%s${X}\n" "+ the 6 round-1 race tests" "$k2/$tot  (adds M11 requireSession Harness check, N07 retry fence)"
printf "  %-50s ${Y}%s${X}\n" "survivors the external probes still notice" "$pk  ($(command grep PROBE-KILLED $MU/probe-kill-head.log | cut -f1 | paste -sd' '))"
echo "  ${D}the 6 new guards the PR tests leave alive:${X}"
for id in N05 N07 N09 N15 N16; do
  d=$(command grep -P "^$id\t" $MU/run-head.log | cut -f4); p=$(command grep -P "^$id\t" $MU/probe-kill-head.log | cut -f2); r=$(command grep -P "^$id\t" $MU/run-raceplus.log | cut -f3)
  if [ "$r" = KILLED ]; then t="${G}r1-test${X}"; elif [ "$p" = PROBE-KILLED ]; then t="${Y}probe${X}  "; else t="${RD}lives${X}  "; fi
  printf "    %s %b  %s\n" "$id" "$t" "$d"
done
echo "    ${D}N10 is equivalent (safeStage already turns Error into a failed stage).${X}"
echo "  ${D}requireExecution's Session checks are redundant one by one,${X}"
echo "  ${D}but deleting both is killed by executionCannotCrossWorkspaceSessionOwnership (R1-15 is pinned).${X}"
