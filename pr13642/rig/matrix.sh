#!/bin/bash
# Real java -jar boot matrix for the retention configuration gate (head jar, MySQL).
S=$SCRATCH
DB=${1:-mysql}; JAR=$S/jars/head.jar
P=QWEN_MANAGED_AGENT_RUNTIME
run() { # name expect env...
  local name=$1 expect=$2; shift 2
  local out; out=$($S/rig/boot.sh $JAR $DB e2e_cfg cfg-$name "$@"); local pid; pid=$(cat $S/rig/logs/cfg-$name.log.pid)
  local thread="-"; local ticks=0
  if [[ $out == STARTED* ]]; then
    sleep 4
    thread=$(jstack $pid 2>/dev/null | grep -c '^"runtime-retention')
    ticks=$(grep -c 'runtime_retention bindings_scanned' $S/rig/logs/cfg-$name.log)
    kill $pid; while kill -0 $pid 2>/dev/null; do sleep 0.5; done
    verdict=BOOTS
  else
    verdict=REFUSES
  fi
  local why; why=$(grep -o 'Runtime Broker retention requires[^"]*\|Failed to bind properties under[^:]*\|Reason: [^\r]*' $S/rig/logs/cfg-$name.log | head -1 | cut -c1-110)
  local ok=PASS; [ "$verdict" = "$expect" ] || ok=FAIL
  printf '%-34s %-8s retention-thread=%-2s ticks=%-2s %s | %s\n' "$name" "$verdict" "$thread" "$ticks" "$ok" "$why"
}
run default                        BOOTS
run broker-off_retention-on        BOOTS   ${P}_RETENTION_ENABLED=true
run broker-on_retention-off        BOOTS   ${P}_BROKER_ENABLED=true
run broker-on_retention-on         BOOTS   ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_SCAN_DELAY=1s
run disabled_batch-0               REFUSES ${P}_RETENTION_BATCH_SIZE=0
run disabled_batch-1001            REFUSES ${P}_RETENTION_BATCH_SIZE=1001
run enabled_batch-1000             BOOTS   ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_BATCH_SIZE=1000 ${P}_RETENTION_SCAN_DELAY=1s
run disabled_max-age-0s            REFUSES ${P}_RETENTION_MAX_AGE=0s
run disabled_max-age-neg           REFUSES ${P}_RETENTION_MAX_AGE=-1d
run disabled_scan-delay-0s         REFUSES ${P}_RETENTION_SCAN_DELAY=0s
run disabled_scan-delay-500us      REFUSES ${P}_RETENTION_SCAN_DELAY=500us
run disabled_batch-abc             REFUSES ${P}_RETENTION_BATCH_SIZE=abc
run enabled_max-age-bare-30        BOOTS   ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_MAX_AGE=30 ${P}_RETENTION_SCAN_DELAY=1s
run enabled_max-age-1ms            BOOTS   ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_MAX_AGE=1ms ${P}_RETENTION_SCAN_DELAY=1s
run enabled_scan-delay-bare-60     BOOTS   ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_SCAN_DELAY=60
