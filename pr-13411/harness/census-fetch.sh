#!/bin/bash
jid=$1
f=logs/$jid.log
if [ ! -f $f ]; then
for i in 1 2 3 4 5; do
  gh api repos/QwenLM/qwen-code/actions/jobs/$jid/logs > $f.tmp 2>/dev/null
  sz=$(stat -c %s $f.tmp)
  if [ "$sz" -gt 20000 ] && grep -q '##\[group\]' $f.tmp && grep -q 'Complete job\|Post job cleanup\|Cleaning up orphan' $f.tmp; then mv $f.tmp $f; break; fi
  sleep 3
done
fi
[ -f $f ] || { echo "FAILED $jid"; rm -f $f.tmp; exit 0; }
sed 's/\x1b\[[0-9;]*m//g' $f | grep -E 'settled file tool outcome is missing|hosted-harness-session.test.ts \(|Failed Tests|Test Files |hosted-harness-session.test.ts:[0-9]+:[0-9]+' | cut -c1-400 > ext/$jid.txt
echo "OK $jid $(wc -l < ext/$jid.txt)"
