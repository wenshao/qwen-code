#!/bin/bash
# sequential arms (each edits the probe worktree): head runs the PR's MySQL IT too
P=$(cd $(dirname $0); pwd)
for A in ${ARMS:-head cand3 f4ee 99ff r3}; do
  echo "######## arm $A start $(date +%T) load $(uptime | sed 's/.*averages: //')"
  if [ $A = head ]; then ITS=",ToolPublicationAsyncVerificationMySqlIT" $P/run.sh $A > $P/run-$A.out 2>&1; else $P/run.sh $A > $P/run-$A.out 2>&1; fi
  echo "######## arm $A done $(date +%T)"; grep -E 'mvn exit|restored|tests=|FAILURE|ERROR ' $P/run-$A.out | head -40
done
echo ALL DONE
