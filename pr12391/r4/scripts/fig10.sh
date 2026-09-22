#!/usr/bin/env bash
# Figure 10: R4 gates, CI, and the guard-deletion sweep on 4ddb2c3. All values from logs.
R=/root/verify/pr12391-harness/r4; L=$R/logs
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; RD=$'\e[31m'; Y=$'\e[33m'; D=$'\e[2m'; X=$'\e[0m'
pick() { command grep -h -E "$2" "$1" | tail -1 | sed -E 's/^\[(INFO|WARNING|ERROR)\] //'; }
echo "${B}${C}PR #12391 round 4 — 4ddb2c3 \"Authenticate the dispatch claim at the CAS boundary\"${X}"
echo "${D}$(head -1 $L/mvn-head-clean_test.log) (eclipse-temurin:21-jdk) · main = $(git -C /root/verify/pr12391-r4-merged rev-parse --short origin/main)${X}"
echo
for arm in head merged; do
  [ $arm = merged ] && echo
  [ $arm = head ] && echo "${B}A. 4ddb2c3${X}" || echo "${B}B. 4ddb2c3 merged into main${X}  ${D}(+ #12390's H2 JdbcRepositoryTest)${X}"
  for g in clean_test:"mvn clean test" checkstyle_check:"mvn checkstyle:check" verify:"mvn verify"; do
    f=$L/mvn-$arm-${g%%:*}.log; t=$(pick $f 'Tests run: [0-9]+, Failures'); c=$(pick $f 'You have [0-9]+ Checkstyle')
    printf "  %-22s %-58s %s\n" "${g#*:}" "$t$c" "${G}$(pick $f 'BUILD (SUCCESS|FAILURE)')${X}"
  done
done
n=$(wc -l < $L/ci-4ddb2c3.tsv); ok=$(command grep -c 'success$' $L/ci-4ddb2c3.tsv)
echo "  ${D}CI on the merge ref: ${X}${G}$ok/$n green${X}${D} — Test (ubuntu-latest, Node 22.x), Lint & Static, and the six SDK Java jobs${X}"
echo
echo "${B}C. Deleting each guard, one at a time${X}  ${D}(your 25 tests, Zulu 21.0.10)${X}"
while IFS=$'\t' read -r id kind v desc killer; do
  [[ "$id" == \#* ]] && continue
  col=$G; [ "$v" = SURVIVED ] && col=$RD
  tag=""; [ "$kind" = deferred ] && tag="${D}(tracking issue)${X}"
  printf "  %s %s%-9s%s %-54s %s%s\n" "$id" "$col" "$v" "$X" "$desc" "${D}${killer%%:*}${X}" "$tag"
done < $R/mutants/run.log
echo "  $(command grep '^# new' $R/mutants/run.log | sed 's/# //') · $(command grep '^# deferred' $R/mutants/run.log | sed 's/# //') (agreed for the post-merge tracking issue)"
