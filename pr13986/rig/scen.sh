#!/bin/bash
# scen.sh <scenario> <jar-arm> [harness-dist] — one scenario on a fresh rig
# (fresh DB, runtime state, cgroup units). Output: out/<tag>/observations.log
# with [OBS]/[RESULT] lines; one summary line per scenario in out/summary.log.
set -u
cd /root/pr13986-rig
S=$1; JAR=$2; HD=${3:-$2}
[ "$HD" = prefix ] && HD=pr
export ARM_JAR=$JAR HARNESS_DIST=$HD WORKER_DIST=$HD
export DB_NAME="q_${S//-/_}_${JAR}_${HD}"
export HARNESS_VIA_PROXY=${VIA_PROXY:-0}
TAG="$S.$JAR.h-$HD"
set -a; source ./rig-env.sh; set +a
C=$TAG
D() { node driver.mjs "$@"; }
log() { echo "$(date +%T) $*" | tee -a "$OUT/$C/steps.log"; }
mkdir -p "$OUT/$C"; : > "$OUT/$C/observations.log"; : > "$OUT/$C/steps.log"
rm -f "$OUT/$C.state.json"

log "== $TAG reset+boot"
bash rig-reset.sh > "$OUT/$C/reset.log" 2>&1
T0=$(date +%s)
bash rig-up.sh > "$OUT/$C/up.log" 2>&1 || { log "BOOT FAILED"; tail -20 "$OUT/$C/up.log"; exit 1; }
log "booted in $(( $(date +%s) - T0 ))s: $(tail -1 "$OUT/$C/up.log")"
HLOG0=$(readlink -f "$LOGS/harness.log")

bg_session() { # bg_session <case> <workspace> <command> [extra json]
  D session "$1" "{\"workspace\":\"$2\",\"command\":\"$3\"${4:+,$4}}" | grep RESULT
  D wait-proc "$1" 150 | grep RESULT
  D settle "$1" 240 | grep RESULT
}
restart_load() { # restart_load <case> <TERM|KILL>
  D restart-harness "$1" "$2" | grep RESULT
  D snap "$1" after-restart | grep RESULT
  D load "$1" | grep RESULT
  D snap "$1" after-load | grep RESULT
}
holds() { [ "$JAR" = base ] && { log "holds: (base jar has no route)"; D holds "$1" | grep RESULT; return; }; D holds "$1" | grep RESULT; }
final() { # cleanup: drain anything a stranded run still holds (rig hygiene)
  [ -f "$OUT/$C.state.json" ] && D snap "$C" final | grep RESULT
  log "harness stderr restore lines: $(grep -h 'could not restore its held Runtimes' $(ls -t $LOGS/harness-*.log | head -3) 2>/dev/null | tail -3)"
}

case $S in
  s0-close-no-restart)
    bg_session $C a 'echo BG-START; sleep TOKEN; echo BG-END'
    holds $C
    D close $C DELETE | grep RESULT
    ;;
  s1-restart-term|s1-restart-kill)
    SIG=TERM; [ $S = s1-restart-kill ] && SIG=KILL
    bg_session $C a 'echo BG-START; sleep TOKEN; echo BG-END'
    holds $C
    restart_load $C $SIG
    holds $C
    D close $C DELETE | grep RESULT
    sleep 5; D snap $C after-delete-5s | grep RESULT
    ;;
  s2-exit-then-restart)
    # doudouOUC P2: the run outlives its turn (routine release refused held),
    # then exits on its own; the hold row settles while the Runtime Session
    # stays READY. A restart + load + close must still drain it.
    bg_session $C a 'echo BG-START; sleep 20; echo BG-END TOKEN'
    D snap $C live | grep RESULT
    log "waiting for the run to exit (20 s sleep)"
    for i in $(seq 1 40); do
      n=$(D sql x "SELECT COUNT(*) FROM qwen_tool_execution WHERE reference_json LIKE '%background_v3%' AND execution_state IN ('SETTLED','ABANDONED')" | tail -1)
      [ "$n" -ge 1 ] 2>/dev/null && break; sleep 2
    done
    D snap $C exited | grep RESULT
    holds $C
    restart_load $C TERM
    holds $C
    D close $C DELETE | grep RESULT
    ;;
  s3-restore-only)
    # The load restores and never discharges: the run keeps going after the
    # load and finishes on its own; only the later close releases.
    bg_session $C a 'for i in $(seq 1 30); do echo tick-$i-TOKEN; sleep 1; done; echo BG-DONE'
    restart_load $C TERM
    D snap $C after-load-alive | grep RESULT
    log "waiting for natural exit"
    for i in $(seq 1 40); do
      n=$(D sql x "SELECT COUNT(*) FROM qwen_tool_execution WHERE reference_json LIKE '%background_v3%' AND execution_state IN ('SETTLED','ABANDONED')" | tail -1)
      [ "$n" -ge 1 ] 2>/dev/null && break; sleep 2
    done
    sleep 3; D snap $C exited-naturally | grep RESULT
    holds $C
    D close $C DELETE | grep RESULT
    ;;
  s4-monitor)
    D session $C '{"workspace":"a","toolName":"monitor","input":{"command":"for i in $(seq 1 300); do echo tick-TOKEN-$i; sleep 2; done","max_events":1000}}' | grep RESULT
    D wait-proc $C 150 | grep RESULT
    D settle $C 240 | grep RESULT
    holds $C
    restart_load $C TERM
    holds $C
    D close $C DELETE | grep RESULT
    sleep 5; D snap $C after-delete-5s | grep RESULT
    ;;
  s5-isolation)
    bg_session ${C}-A a 'echo A; sleep TOKEN; echo A-END'
    bg_session ${C}-B b 'echo B; sleep TOKEN; echo B-END'
    D holds ${C}-A | grep RESULT; D holds ${C}-B | grep RESULT
    D restart-harness ${C}-A TERM | grep RESULT
    D load ${C}-A | grep RESULT
    D holds ${C}-A | grep RESULT; D holds ${C}-B | grep RESULT
    D close ${C}-A DELETE | grep RESULT
    D snap ${C}-B b-after-a-delete | grep RESULT
    D load ${C}-B | grep RESULT
    D close ${C}-B DELETE | grep RESULT
    ;;
  s6-degrade)
    # Fault on the new route only (VIA_PROXY=1 + PROXY_RULES), or a mixed
    # version (new Harness + old Broker) with no proxy.
    [ -n "${PROXY_RULES:-}" ] && D proxy x "$PROXY_RULES" | grep RESULT
    bg_session $C a 'echo BG-START; sleep TOKEN; echo BG-END'
    restart_load $C TERM
    [ "${HARNESS_VIA_PROXY}" = 1 ] && D proxy-log $C | grep RESULT
    D close $C DELETE | grep RESULT
    ;;
  s7-detach-load)
    bg_session $C a 'echo BG-START; sleep TOKEN; echo BG-END'
    D close $C detach | grep RESULT
    D load $C | grep RESULT
    D snap $C after-load | grep RESULT
    D close $C DELETE | grep RESULT
    ;;
  s2b-exit-broker-restart)
    # The run exits; a Broker (Spring) restart's reconciliation observes the
    # exit and may settle the hold row while the Runtime Session stays
    # READY — the review's shape. Then restart the Harness, load, close.
    bg_session $C a 'echo BG-START; sleep 20; echo BG-END TOKEN'
    log "waiting for the run to exit (20 s sleep)"
    for i in $(seq 1 40); do
      [ "$(node driver.mjs snap $C wait | grep -c '"procs":0')" = 1 ] && break; sleep 2
    done
    sleep 3
    D snap $C exited | grep RESULT
    D restart-spring $C | grep RESULT
    holds $C
    restart_load $C TERM
    holds $C
    D close $C DELETE | grep RESULT
    ;;
  s8-next-session)
    # User-visible cost of a strand: after the restart+load+close, a NEW
    # Session in the same Workspace runs a foreground Shell call.
    bg_session $C a 'echo BG-START; sleep TOKEN; echo BG-END'
    restart_load $C TERM
    D close $C DELETE | grep RESULT
    D session ${C}-next '{"workspace":"a","input":{"command":"echo NEXT-SESSION-TOKEN"},"marker":"P13986_NEXT"}' | grep RESULT
    D settle ${C}-next 120 | grep RESULT
    D outcome ${C}-next | grep RESULT
    ;;
  s9-exit-broker-restart-noharness)
    # Same as s2b but WITHOUT a Harness restart: the live Harness still holds
    # the obligation in memory (#13856 path) — is the 503 pre-existing?
    bg_session $C a 'echo BG-START; sleep 20; echo BG-END TOKEN'
    for i in $(seq 1 40); do
      [ "$(node driver.mjs snap $C wait | grep -c '"procs":0')" = 1 ] && break; sleep 2
    done
    sleep 3
    D restart-spring $C | grep RESULT
    D close $C DELETE | grep RESULT
    D close-retry $C 4x30 | grep RESULT
    ;;
  s10-live-broker-restart)
    # Live run; Broker (Spring) restart; then Harness restart + load + close.
    bg_session $C a 'echo BG-START; sleep TOKEN; echo BG-END'
    D restart-spring $C | grep RESULT
    holds $C
    restart_load $C TERM
    holds $C
    D close $C DELETE | grep RESULT
    D close-retry $C 4x30 | grep RESULT
    ;;
  s11-live-broker-restart-noharness)
    bg_session $C a 'echo BG-START; sleep TOKEN; echo BG-END'
    D restart-spring $C | grep RESULT
    D close $C DELETE | grep RESULT
    D close-retry $C 4x30 | grep RESULT
    ;;
  s2c-exit-broker-restart-retry)
    # s2b plus DELETE retries over two minutes.
    bg_session $C a 'echo BG-START; sleep 20; echo BG-END TOKEN'
    for i in $(seq 1 40); do
      [ "$(node driver.mjs snap $C wait | grep -c '"procs":0')" = 1 ] && break; sleep 2
    done
    sleep 3
    D restart-spring $C | grep RESULT
    restart_load $C TERM
    holds $C
    D close $C DELETE | grep RESULT
    D close-retry $C 4x30 | grep RESULT
    ;;
  *) echo "unknown scenario $S"; exit 2;;
esac
final
grep '\[RESULT\]' "$OUT/$C"*/observations.log > /dev/null
echo "$(date +%T) $TAG done" >> "$OUT/summary.log"
log "== $TAG DONE"
