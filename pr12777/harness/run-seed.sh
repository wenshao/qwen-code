#!/bin/bash
# usage: run-seed.sh <seed> <n>  -> cases-<seed>.json, out-*.jsonl, examples-<seed>.json
set -e
S=$1; N=$2
node make-cases.mjs $S $N cases-$S.json
for a in precache:$HOME/git/qwen-code-pr12747-base main:$HOME/git/qwen-code-pr12777-base pr:$HOME/git/qwen-code-pr12777; do
  n=${a%%:*}; r=${a#*:}
  node --import ./register.mjs child.mjs $r/packages/core/dist/src/utils/schemaValidator.js cases-$S.json > out-$n.jsonl
done
node compare.mjs cases-$S.json examples-$S.json
mkdir -p seed-$S && cp out-*.jsonl seed-$S/
