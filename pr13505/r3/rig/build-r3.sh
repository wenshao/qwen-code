#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505 round 3): install + TS build/bundle + Java jar for h2 and m2, serially.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
R=/Users/wenshao/git/pr13505-rig
for w in h3 m3 mut3; do
  cd /Users/wenshao/git/pr13505-$w
  node scripts/setup-worktree.js > $R/logs/setup-$w.log 2>&1; s1=$?
  s=$(date +%s); npm run build > $R/logs/build-$w.log 2>&1; b=$?
  npm run bundle > $R/logs/bundle-$w.log 2>&1; u=$?
  printf 'BUILD\t%s\t%s\tsetup=%s\tbuild=%s\tbundle=%s\t%ss\n' "$w" "$(git rev-parse --short=10 HEAD)" $s1 $b $u $(( $(date +%s) - s )) | tee -a $R/results/build.tsv
done
for w in h3 m3; do
  $R/build-java.sh $w /Users/wenshao/git/pr13505-$w $R/m2 2>&1 | tail -2
done
