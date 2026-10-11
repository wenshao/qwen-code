#!/bin/bash
# Follow-up queue: E2E-3 (kill -9 inside an uncommitted page) on the merged classes, and the head's migration IT on both engines.
R=/Users/wenshao/pr13554-rig; E=$R/e2e; Q=$R/r5/results
until [ -f $Q/queue5.done ]; do sleep 15; done
cd $E && [ -d out-e2e3 ] && mv out-e2e3 out-e2e3-r4
ARM=x5 ./e2e3.sh > $Q/e2e/E2E3-x5.log 2>&1; kill $(cat $E/run/e2e3-C.pid) 2>/dev/null
[ -d out-e2e3 ] && mv out-e2e3 out-e2e3-x5
for h in mysql84 mariadb; do $R/probe5/run-it.sh it-head m2-x5 WorkspaceMigrationMySqlIT $h it-head-mig > /dev/null; done
echo done > $Q/queue5b.done
