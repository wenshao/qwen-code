#!/bin/bash
# VERIFICATION RIG ONLY (PR #13536): install + TS build (+bundle for head/base) + Java jar, serially.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
R=/Users/wenshao/git/pr13536-rig
for w in head base h1; do
  cd /Users/wenshao/git/pr13536-$w
  node scripts/setup-worktree.js > $R/logs/setup-$w.log 2>&1; s1=$?
  s=$(date +%s); npm run build > $R/logs/build-$w.log 2>&1; b=$?
  u=skip; if [ $w != h1 ]; then npm run bundle > $R/logs/bundle-$w.log 2>&1; u=$?; fi
  printf 'BUILD\t%s\t%s\tsetup=%s\tbuild=%s\tbundle=%s\t%ss\n' "$w" "$(git rev-parse --short=10 HEAD)" $s1 $b $u $(( $(date +%s) - s )) | tee -a $R/results/build.tsv
done
for w in head base h1; do
  $R/build-java.sh $w /Users/wenshao/git/pr13536-$w /Users/wenshao/git/pr13505-rig/m2 2>&1 | tail -3
done
echo ALL-BUILD-DONE
