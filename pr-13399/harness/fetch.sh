#!/bin/bash
jid=$1
f=logs/$jid.log
[ -f $f ] && { echo "CACHED $jid"; exit 0; }
for i in 1 2 3 4 5; do
  gh api repos/QwenLM/qwen-code/actions/jobs/$jid/logs > $f.tmp 2>/dev/null
  sz=$(stat -c %s $f.tmp)
  if [ "$sz" -gt 20000 ] && grep -q '##\[group\]' $f.tmp && grep -q 'Complete job\|Post job cleanup\|Cleaning up orphan' $f.tmp; then mv $f.tmp $f; break; fi
  sleep 3
done
[ -f $f ] || { echo "FAILED $jid"; rm -f $f.tmp; exit 0; }
echo "OK $jid $(stat -c %s $f)"
