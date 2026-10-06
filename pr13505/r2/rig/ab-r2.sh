#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505 round 2): whole hosted-harness-session.test.ts, base vs h2, interleaved.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
R=/Users/wenshao/git/pr13505-rig
for i in 1 2 3; do for a in base h2; do
  cd /Users/wenshao/git/pr13505-$a/packages/cli
  npx vitest run src/serve/hosted-harness-session.test.ts > $R/logs/ab2-hhs-$a-$i.log 2>&1; c=$?
  fails=$(grep -E "^ FAIL " $R/logs/ab2-hhs-$a-$i.log | sort -u | sed 's/.*> //' | tr '\n' ';')
  printf 'AB2\thosted-harness-session\t%s\t%s\texit=%s\t%s\t%s\n' $a $i $c "$(grep -E '^ +Tests ' $R/logs/ab2-hhs-$a-$i.log | tail -1 | tr -s ' ')" "$fails" | tee -a $R/results/ab-r2.tsv
done; done
