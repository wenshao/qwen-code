#!/usr/bin/env bash
# Figure 4: gates, negative control, and the guard-deletion sweep. All values from logs/.
H=/root/verify/pr12438-harness; L=$H/logs; MU=$H/mutants
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; RD=$'\e[31m'; Y=$'\e[33m'; D=$'\e[2m'; X=$'\e[0m'
strip() { sed -E 's/\x1b\[[0-9;]*m//g'; }
pick() { command grep -h -E "$2" "$1" | tail -1 | strip | sed -E 's/^\[(INFO|WARNING|ERROR)\] //'; }
echo "${B}${C}PR #12438 @ 054159f — gates, negative control, guard-deletion sweep${X}"
echo "${D}$(pick $L/gate-head-jdk21.log 'openjdk version') (eclipse-temurin:21-jdk container) · head is on current main (merge-base = main tip)${X}"
echo
echo "${B}A. Gates${X}"
printf "  %-34s %-52s %s\n" "mvn verify (PR head)" "$(pick $L/gate-head-jdk21.log 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$')" "${G}BUILD SUCCESS${X}"
printf "  %-34s %-52s %s\n" "mvn checkstyle:check (PR head)" "$(pick $L/gate-head-jdk21.log 'Checkstyle violations')" "${G}BUILD SUCCESS${X}"
printf "  %-34s %-52s %s\n" "mvn verify (patch + 6 tests)" "$(pick $L/gate-fix-jdk21.log 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$')" "${G}BUILD SUCCESS${X}"
printf "  %-34s %-52s %s\n" "root install/build/typecheck" "$(command grep -ho 'INSTALL_EXIT=[0-9]* [0-9]*s' $L/root-install.log) · $(command grep -ho 'BUILD_EXIT=[0-9]* [0-9]*s' $L/root-build.log) · $(command grep -ho 'TYPECHECK_EXIT=[0-9]* [0-9]*s' $L/root-typecheck.log)" "${G}ok${X}"
n=$(wc -l < $L/ci-054159f.tsv); ok=$(command grep -c 'pass$' $L/ci-054159f.tsv)
echo "  ${D}CI on 054159f: ${X}${G}$ok/$n green${X}${D} (incl. SDK Java 11/17/21 on ubuntu, 21 on macOS + Windows)${X}"
echo
echo "${B}B. Negative control${X}  ${D}— the 6 proposed tests on the unpatched head${X}"
command grep -E '^\[ERROR\]   RuntimeBrokerServiceRaceTest' $L/negctl-head-plus-tests.log | strip | sed -E 's/^\[ERROR\]   RuntimeBrokerServiceRaceTest\.//; s/->lambda[^ ]* » Completion .*RuntimeBrokerException: persisted Runtime readiness requires adoption or reconciliation in this Broker process/  » runtime_reconciliation_required (503)/' | while IFS= read -r l; do echo "  ${RD}FAIL${X} ${l:0:130}"; done
echo "  ${G}pass${X} anotherHarnessSessionCannotDriveARuntimeSession ${D}(guard already correct; the test pins it — see M11)${X}"
echo
echo "${B}C. Deleting each guard in RuntimeBrokerService, one at a time${X}  ${D}(PR's 17 service tests, JDK 21.0.10) · killed = a PR test fails · probe = only the external probes notice · lives = neither${X}"
declare -A PK; while IFS=$'\t' read -r id v rest; do [[ "$id" == M* ]] && PK[$id]=$v; done < $MU/probe-kill-head.log
cols=0; line=""
while IFS=$'\t' read -r id area v desc killer; do
  [[ "$id" == \#* ]] && continue
  if [ "$v" = KILLED ]; then tag="${G}killed${X}"; elif [ "$id" = M23 ]; then tag="${D}=fix 2${X}"; elif [ "${PK[$id]}" = PROBE-KILLED ]; then tag="${Y}probe${X} "; else tag="${RD}lives${X} "; fi
  printf "  %s %s %-50s" "$id" "$tag" "${desc:0:50}"
  cols=$((cols+1)); if [ $cols = 2 ]; then echo; cols=0; fi
done < $MU/run-head.log
[ $cols = 1 ] && echo
pk=$(command grep -c PROBE-KILLED $MU/probe-kill-head.log); pk=$((pk-1))
echo "  $(command grep '^# killed' $MU/run-head.log | sed 's/# //') by the PR's tests; the external probes notice $pk more; the 6 proposed tests add M11 and M27"
echo "  ${D}M23 (dispatch every non-settled record) is not a regression — it is the finding-2 fix, so the probe sees S2 turn green${X}"
