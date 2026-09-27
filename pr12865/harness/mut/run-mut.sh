#!/bin/bash
# runs inside the Linux container
set -u
printf '%s\n' "$1" > /etc/machine-id
rm -rf /work && mkdir -p /work && cp -a /rig/src/. /work/
D=/work/packages/sdk-java/runtime-broker
SRC=$D/src/main/java/com/alibaba/qwen/code/runtimebroker
cd $D
TESTS=${TESTS:-DurableLocalProcessRuntimeProvisionerTest}
OUT=/rig/out/mut-results.tsv; : > $OUT
run() { mvn -o -B -ntp test -Dtest="$TESTS" -Dsurefire.failIfNoSpecifiedTests=false > /tmp/mut.log 2>&1; }
run; base=$(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' /tmp/mut.log | tail -1)
echo -e "BASE\t-\t$base" | tee -a $OUT
while IFS=$'\t' read -r id file from to desc; do
  [ -z "$id" ] && continue
  f=$SRC/$file; cp $f /tmp/orig.java
  FROM="$from" TO="$to" perl -0pi -e 'my $f=$ENV{FROM}; my $t=$ENV{TO}; $t =~ s/\\n/\n/g; s/$f/$t/' $f
  if cmp -s $f /tmp/orig.java; then echo -e "$id\tNOT-APPLIED\t$desc" | tee -a $OUT; continue; fi
  run
  line=$(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' /tmp/mut.log | tail -1)
  if grep -q "COMPILATION ERROR" /tmp/mut.log; then verdict=COMPILE-ERROR
  elif echo "$line" | grep -qE 'Failures: 0, Errors: 0'; then verdict=SURVIVED
  else verdict=KILLED; fi
  killers=$(grep -E '<<< (FAILURE|ERROR)!' /tmp/mut.log | grep -oE '\.[A-Za-z]+(\([^)]*\))?(\[[0-9]+\])? --' | sed 's/ --//; s/^\.//' | sort -u | head -4 | tr '\n' ' ')
  echo -e "$id\t$verdict\t$desc\t$line\t$killers" | tee -a $OUT
  cp /tmp/orig.java $f
done < /rig/mut/mutants.tsv
