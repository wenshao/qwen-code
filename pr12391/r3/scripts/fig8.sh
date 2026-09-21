#!/usr/bin/env bash
# Figure 8: R3 gates, plus the author's own 10:06 pinning test run against 25a38c3. All values from logs.
R=/root/verify/pr12391-harness/r3; L=$R/logs
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; RD=$'\e[31m'; D=$'\e[2m'; X=$'\e[0m'
pick() { command grep -h -E "$2" "$1" | tail -1 | sed -E 's/^\[(INFO|WARNING|ERROR)\] //'; }
echo "${B}${C}PR #12391 round 3 — 25a38c3 \"Fence tool execution settlement behind the dispatch claim\"${X}"
echo "${D}$(head -1 $L/mvn-head-clean_test.log) (eclipse-temurin:21-jdk) · main = 2800e9b, no sdk-java change since round 2${X}"
echo
for arm in head merged; do
  [ $arm = merged ] && echo; [ $arm = head ] && echo "${B}A. 25a38c3${X}" || echo "${B}B. 25a38c3 merged into main 2800e9b${X}  ${D}(+ #12390's H2 JdbcRepositoryTest)${X}"
  for g in clean_test:"mvn clean test" checkstyle_check:"mvn checkstyle:check" verify:"mvn verify"; do
    f=$L/mvn-$arm-${g%%:*}.log; t=$(pick $f 'Tests run: [0-9]+, Failures'); c=$(pick $f 'You have [0-9]+ Checkstyle')
    printf "  %-22s %-58s %s\n" "${g#*:}" "$t$c" "${G}$(pick $f 'BUILD (SUCCESS|FAILURE)')${X}"
  done
done
echo
n=$(wc -l < $L/ci-25a38c3.tsv); ok=$(command grep -c 'success$' $L/ci-25a38c3.tsv)
echo "  ${D}CI on the merge ref: ${X}${G}$ok/$n green${X}${D} — Test (ubuntu, Node 22.x), Lint & Static, and the six SDK Java jobs${X}"
echo
echo "${B}C. Your own pinning test from 10:06 — \"owner A re-reads for a fresh version, withResult must fail\"${X}"
echo "${D}   written from your description and added to the suite; 2-arg CAS as shipped (Zulu 21.0.10);${X}"
echo "${D}   in the +actor arms the same test passes the caller's own owner/generation${X}"
printf "  %-12s %s\n" "25a38c3" "${RD}$(command grep -h -E 'Tests run: [0-9]+, Failures: [1-9]' $L/arm-T-test.log | head -1 | sed -E 's/^\[ERROR\] //; s/, Time elapsed.*//')${X}"
printf "  %-12s %s\n" "" "${RD}$(command grep -h -E '^\[ERROR\]   InMemoryRepositoryTest\.' $L/arm-T-test.log | head -1 | sed -E 's/^\[ERROR\]   InMemoryRepositoryTest\.//; s/com\.alibaba\.qwen\.code\.runtimebroker\.//')${X}"
for a in F F2; do
  printf "  %-12s %s\n" "+$( [ $a = F ] && echo actor || echo actor+rule)" "${G}$(cat $R/trees/$a/sdk-java/runtime-broker/target/surefire-reports/*.txt | command grep 'Tests run' | head -1 | sed -E 's/, Time elapsed.*//')${X}  ${D}(+ $( [ $a = F ] && echo "a stale-generation test" || echo "stale-generation and no-backwards tests"))${X}"
done
