#!/bin/bash
# usage: st5all.sh "<db> <name>..." ...   — compact state of several stacks
cd /Users/wenshao/git/pr13598-rig
for spec in "$@"; do
  set -- $spec; db=$1; shift
  echo "################ $db $(date -u +%T)"
  ./st4.sh $db "$@" 2>/dev/null | cut -c1-170 | grep -vE "^(-- (turns|runs|occurrences))$"
  echo "busy=$(grep -c workspace_busy runs/$db/broker-tap.jsonl) tap-refused=$(grep -c 'refused by tap' runs/$db/broker-tap.jsonl)"
done
