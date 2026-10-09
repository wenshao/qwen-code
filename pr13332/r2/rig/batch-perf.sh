#!/bin/bash
R=/Users/wenshao/git/pr13332-rig
cd $R
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export NO_PROXY=127.0.0.1,localhost
: > results/perf.jsonl
for rep in 1 2 3; do
  for store in http local; do
    for arm in base head; do
      perl -e 'alarm shift; exec @ARGV' 900 node perf.mjs $arm $store results/perf.jsonl > /dev/null 2>> logs/perf.err || echo "FAIL rep=$rep $arm $store" >> logs/perf.err
    done
  done
done
echo PERF_DONE
