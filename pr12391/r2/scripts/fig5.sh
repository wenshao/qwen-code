#!/usr/bin/env bash
# Figure 5: gates on the PR head and on the PR merged into current main. Every number is grepped from a log.
L=/root/verify/pr12391-harness/logs
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; Y=$'\e[33m'; D=$'\e[2m'; R=$'\e[0m'
ok() { printf "%s" "${G}$1${R}"; }
tr() { grep -h -E "$2" "$1" | tail -1 | sed -E 's/^\[(INFO|WARNING)\] //'; }
jv=$(head -1 $L/mvn-head-clean_test.log)
echo "${B}${C}PR #12391 round 2 — gates${R}   ${D}container eclipse-temurin:21-jdk → ${jv}${R}"
echo
echo "${B}A. PR head 9fcc065${R}  ${D}(unchanged since round 1)${R}"
for g in clean_test:"mvn clean test" checkstyle_check:"mvn checkstyle:check" verify:"mvn verify"; do
  f=$L/mvn-head-${g%%:*}.log; n=${g#*:}
  t=$(tr $f 'Tests run: [0-9]+, Failures' ); c=$(tr $f 'You have [0-9]+ Checkstyle'); b=$(tr $f 'BUILD (SUCCESS|FAILURE)')
  printf "  %-22s %-58s %s\n" "$n" "${t}${c}" "$(ok "$b")"
done
echo
echo "${B}B. PR merged into main da695fe${R}  ${D}(#12390 JDBC persistence landed 11:25 UTC, after round 1; later main commits do not touch sdk-java)${R}"
for g in clean_test:"mvn clean test" checkstyle_check:"mvn checkstyle:check" verify:"mvn verify"; do
  f=$L/mvn-merged-${g%%:*}.log; n=${g#*:}
  t=$(tr $f 'Tests run: [0-9]+, Failures' ); c=$(tr $f 'You have [0-9]+ Checkstyle'); b=$(tr $f 'BUILD (SUCCESS|FAILURE)')
  printf "  %-22s %-58s %s\n" "$n" "${t}${c}" "$(ok "$b")"
done
grep -h -E "Tests run: .* in com" $L/mvn-merged-clean_test.log | sed -E 's/^\[INFO\] Tests run: ([0-9]+).* in com\.alibaba\.qwen\.code\.runtimebroker\.(.*)/    \2: \1 test(s)/' | sed "s/^/${D}/;s/$/${R}/"
echo "    ${D}git merge: clean · ToolExecution*/BrokerValues/InMemoryRepositoryTest: 0-line diff vs PR head${R}"
echo
echo "${B}C. Root gates from your Test Plan, on the head${R}  ${D}(round 1 did not run these) · node $(sed -n 2p $L/root-gates.summary) · pnpm 11.24.0${R}"
while IFS= read -r line; do
  case "$line" in
    pnpm*|npm*) name=$(echo "$line" | sed -E 's/ exit=.*//'); ex=$(echo "$line" | sed -E 's/.*exit=([0-9]+).*/\1/'); s=$(echo "$line" | sed -E 's/.*secs=([0-9]+).*/\1/')
      extra=""; [ "$name" = "npm run typecheck" ] && extra="  $(grep -c 'error TS' $L/npm-typecheck.log) × 'error TS'"
      [ "$name" = "pnpm install" ] && name="(prep) pnpm install --frozen-lockfile"; [ "$name" = "(prep) pnpm install --frozen-lockfile" ] && extra="  QWEN_SKIP_PREPARE=1 HUSKY=0"
      printf "  %-38s %s  %4ss%s\n" "$name" "$( [ "$ex" = 0 ] && ok "exit 0" || echo "exit $ex")" "$s" "$extra";;
    git*) printf "  %-38s %s\n" "git status --porcelain" "$(ok "$(echo "$line" | sed -E 's/git status after: //')")";;
  esac
done < $L/root-gates.summary
