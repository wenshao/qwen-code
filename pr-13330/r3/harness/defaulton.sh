#!/bin/bash
R=/root/pr13330-r3
for arm in base head; do for i in 1 2 3 4; do
  $R/mvn.sh $arm managed-agent-server 2 4g -Dtest=RuntimeBrokerDefaultOnTest test > $R/logs/defaulton-$arm-$i.log 2>&1; echo EXIT=$? >> $R/logs/defaulton-$arm-$i.log
done; done
