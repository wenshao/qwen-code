#!/bin/zsh
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ee3d6caa-6091-40f9-ade7-5e9a755f3096/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH
cd $SP/wt/packages/sdk-java/runtime-broker
for i in 1 2 3 4 5 6; do
  s=$(date +%s)
  mvn -B -ntp -o -s $SP/settings.xml -Dmaven.repo.local=$SP/m2repo -Pfault-gates test > $SP/gates-r2-run$i.log 2>&1
  rc=$?
  e=$(date +%s)
  w=$(ps -eo pid,command | grep '[m]anaged-runtime-worker' | grep -c "$SP")
  b=$(ps -eo pid,command | grep '[F]aultGateBroker' | grep -c "$SP")
  echo "run$i rc=$rc secs=$((e-s)) $(grep -E 'Tests run: [0-9]+, Failures' $SP/gates-r2-run$i.log | tail -1) leftover_workers=$w leftover_brokers=$b" >> $SP/repeat2.txt
done
