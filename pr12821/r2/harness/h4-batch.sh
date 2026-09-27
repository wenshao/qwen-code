#!/bin/sh
cd $SCRATCH/harness
REPO=$SCRATCH/wt-h4 ./sweep.sh h4 3 1.0000086 1.0625 10.0009765625 10.03125 10.0625 10.1 10.125 20.0625 10 100.0000086 > /dev/null 2>&1
for sc in "s2-slow-store|20 64|{\"storeFault\":{\"slowMs\":150}}|" "s3-inherited-pipe|2 64 0 inherit|{}|" "s4-cancel|8 64 30|{}|1" "s5-store-refuses|10 64|{\"storeFault\":{\"failAtOrdinal\":3}}|" "s6-kill-before-receipt|20 64|{\"crash\":\"before-accept\"}|" "s1-100mib-plus9|100.0000086 3072|{}|"; do
  n=h4-$(echo "$sc" | cut -d'|' -f1); g=$(echo "$sc" | cut -d'|' -f2); x=$(echo "$sc" | cut -d'|' -f3); c=$(echo "$sc" | cut -d'|' -f4)
  REPO=$SCRATCH/wt-h4 ./scenario.sh "$n" "$g" "$x" $c > /dev/null 2>&1; REPO=$SCRATCH/wt-h4 ./finish.sh "$n" > /dev/null 2>&1
done
./run-suites.sh $SCRATCH/wt-h4 h4
(cd $SCRATCH/wt-h4/packages/sdk-java/runtime-broker && mvn -q -o clean test -Dtest=HttpRuntimeTransportTest > $SCRATCH/harness/out/java-h4.log 2>&1; echo "exit $?" >> $SCRATCH/harness/out/java-h4.log)
echo DONE > out/h4.done
