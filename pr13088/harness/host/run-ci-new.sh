#!/bin/bash
# macOS host: candidate integration gates, then the Hosted MySQL CI job replayed for the new head, then the fault gates.
RIG=/rig; DK="$RIG/dk.sh run --rm --network host --dns 192.168.5.2 --dns 223.5.5.5 --memory 6g -v $RIG:/rig -v $RIG/m2:/root/.m2/repository pr12865-linux:latest"
$RIG/vmrun.sh 'bash svc.sh stop; for p in $(pgrep -x node || true); do c=$(tr "\0" " " < /proc/$p/cmdline 2>/dev/null); case "$c" in *"/opt/w1a/"*) kill -9 $p;; esac; done' > /dev/null 2>&1
echo "=== $(date +%T) candidate: W1a integration gates"
cp $RIG/out/mut-java-it/BASE-1.log $RIG/out/mut-java-it/head-BASE-1.log
$DK bash /rig/mut/java-it.sh src-cand new BASE > $RIG/out/mut-java-it-cand.console 2>&1
mv $RIG/out/mut-java-it/BASE-1.log $RIG/out/mut-java-it/cand-BASE-1.log; cp $RIG/out/mut-java-it/head-BASE-1.log $RIG/out/mut-java-it/BASE-1.log
cut -c1-300 $RIG/out/mut-java-it-cand.console
echo "=== $(date +%T) CI replay: hosted-harness-mysql job at 7c54aa78"
$DK bash /rig/ci-hosted.sh wt-merge new > $RIG/out/ci-hosted-new.console 2>&1
tr -cd '\11\12\15\40-\176' < $RIG/out/ci-hosted-new.console | tail -40
echo "=== $(date +%T) fault gates (local-disk copy)"
$DK bash /rig/gates-local.sh wt-merge new > $RIG/out/gates-new.console 2>&1
cat $RIG/out/gates-new.console
echo "=== $(date +%T) DONE"
