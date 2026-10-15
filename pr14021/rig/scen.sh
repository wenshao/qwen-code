#!/bin/bash
# scen.sh <scenario> <harness-arm: pr|base> — one scenario on a fresh rig
# (fresh DB, runtime state, cgroup units). Output: out/<tag>/observations.log
# with [OBS]/[RESULT] lines, one summary line per scenario in out/summary.log.
set -u
cd /root/pr14021-rig
S=$1; HD=$2
export ARM_JAR=main HARNESS_DIST=$HD WORKER_DIST=$HD
export DB_NAME="v_${S//-/_}_${HD}"
export HARNESS_VIA_PROXY=1   # every case routes Harness→Broker through bproxy (transparent unless a rule is set)
TAG="$S.$HD"
case $S in s1-*|c1-*) export PUB_ACTIVE_CAPTURES=1 ;; *) export PUB_ACTIVE_CAPTURES=64 ;; esac
set -a; source ./rig-env.sh; set +a
C=$TAG
D() { node driver.mjs "$@"; }
log() { echo "$(date +%T) $*" | tee -a "$OUT/$C/steps.log"; }
mkdir -p "$OUT/$C"; : > "$OUT/$C/observations.log"; : > "$OUT/$C/steps.log"
rm -f "$OUT/$C.state.json" "$OUT/$C-hold.state.json"

log "== $TAG reset+boot (active-captures=$PUB_ACTIVE_CAPTURES)"
bash rig-reset.sh > "$OUT/$C/reset.log" 2>&1
T0=$(date +%s)
bash rig-up.sh > "$OUT/$C/up.log" 2>&1 || { log "BOOT FAILED"; tail -20 "$OUT/$C/up.log"; exit 1; }
log "booted in $(( $(date +%s) - T0 ))s: $(tail -1 "$OUT/$C/up.log")"
HLOG=$(readlink -f "$LOGS/harness.log")
D proxy x '[]' > /dev/null; D sproxy x '[]' > /dev/null
curl -s -X DELETE "http://127.0.0.1:$PROXY_PORT/__rig/log" > /dev/null
curl -s -X DELETE "http://127.0.0.1:$STORE_PROXY_PORT/__rig/log" > /dev/null

observe() { # observe <case> <label>
  D snap "$1" "$2" | grep RESULT
  D tasks "$1" "$2" | grep RESULT
  D process "$1" "$2" | grep RESULT
}
stderr_lines() {
  log "harness stderr (qwen serve:) lines:"
  grep -h 'qwen serve:' "$HLOG" | grep -v -i 'listening' | cut -c1-400 | tee -a "$OUT/$C/steps.log" | tail -12
}
# A background Shell whose turn is expected to fail (no wait-proc).
bg_fail() { # bg_fail <case> <command>
  D session "$1" "{\"workspace\":\"a\",\"command\":\"$2\"}" | grep RESULT
  D settle "$1" 120 | grep RESULT
}

case $S in
  s0-normal)
    # Sanity: the same background Shell with no fault starts and stays attached.
    D session $C '{"workspace":"a","command":"echo BG-START; sleep TOKEN; echo BG-END"}' | grep RESULT
    D wait-proc $C 90 | grep RESULT
    D settle $C 120 | grep RESULT
    observe $C live
    ;;
  s1-capacity)
    # Tenant publication capacity = 1. A holder Session runs a long background
    # Shell that keeps the only capture slot; this Session's background Shell
    # is then refused at reservation ("Publication capacity exhausted") before
    # any publication row exists — a product refusal, nothing injected.
    H=$C-hold
    D session $H '{"workspace":"b","command":"echo HOLD-START; sleep TOKEN; echo HOLD-END","marker":"P14021_HOLDER"}' | grep RESULT
    D wait-proc $H 90 | grep RESULT
    D settle $H 120 | grep RESULT
    D snap $H holder | grep RESULT
    log "holder owns the capture slot; starting the refused Session"
    bg_fail $C 'echo REFUSED-START TOKEN; touch /tmp/pr14021-side-effect-TOKEN; sleep TOKEN'
    D status $C | grep RESULT
    observe $C after-turn
    log "side-effect file present? $(ls /tmp/pr14021-side-effect-* 2>/dev/null | wc -l)"
    sleep 20
    observe $C after-20s
    ;;
  s1-reload)
    # s1, then a Harness restart + Session load: base reaches the same terminal
    # only through #13917's reload reconciliation; the PR arm must stay put.
    H=$C-hold
    D session $H '{"workspace":"b","command":"echo HOLD-START; sleep TOKEN; echo HOLD-END","marker":"P14021_HOLDER"}' | grep RESULT
    D wait-proc $H 90 | grep RESULT
    D settle $H 120 | grep RESULT
    bg_fail $C 'echo REFUSED-START TOKEN; touch /tmp/pr14021-side-effect-TOKEN; sleep TOKEN'
    observe $C before-reload
    D restart-harness $C TERM | grep RESULT
    D load $C | grep RESULT
    sleep 3
    observe $C after-reload
    ;;
  s1-monitor)
    # Monitor half: the same capacity refusal for a monitor_run. The PR's
    # fallback is scoped to background Shell and must not read the ledger here.
    H=$C-hold
    D session $H '{"workspace":"b","command":"echo HOLD-START; sleep TOKEN; echo HOLD-END","marker":"P14021_HOLDER"}' | grep RESULT
    D wait-proc $H 90 | grep RESULT
    D settle $H 120 | grep RESULT
    D session $C '{"workspace":"a","toolName":"monitor","input":{"command":"echo MON-START TOKEN; sleep TOKEN","description":"pr14021 monitor"}}' | grep RESULT
    D settle $C 120 | grep RESULT
    observe $C after-turn
    D plog $C broker | grep RESULT
    ;;
  s2-store503)
    # The author's fault class: the Session Store answers 503 to every
    # reservation (three attempts), so no publication row is ever created.
    export STORE_VIA_PROXY=1
    D sproxy x '[{"path":"/grants","bodyHas":"\"operation\":\"reserve\"","action":"status","status":503,"body":{"code":"managed_session_store_unavailable","error":"rig injected"}}]' | grep RESULT
    bg_fail $C 'echo REFUSED-START TOKEN; touch /tmp/pr14021-side-effect-TOKEN; sleep TOKEN'
    D status $C | grep RESULT
    observe $C after-turn
    D plog $C store | grep RESULT
    D plog $C broker | grep RESULT
    ;;
  c1-probe503)
    # Control: same capacity refusal, but the Broker answers 503 to the
    # :process ledger read — absence is not proven, the record must stay open.
    H=$C-hold
    D session $H '{"workspace":"b","command":"echo HOLD-START; sleep TOKEN; echo HOLD-END","marker":"P14021_HOLDER"}' | grep RESULT
    D wait-proc $H 90 | grep RESULT
    D settle $H 120 | grep RESULT
    D proxy x '[{"pathRe":"(:|%3A)process$","action":"status","status":503,"body":{"code":"runtime_broker_unavailable","error":"rig injected"}}]' | grep RESULT
    bg_fail $C 'echo REFUSED-START TOKEN; touch /tmp/pr14021-side-effect-TOKEN; sleep TOKEN'
    D proxy x '[]' | grep RESULT
    observe $C after-turn
    D plog $C broker | grep RESULT
    ;;
  c2-started)
    # Control: the start really reaches the Broker (process admitted), but its
    # answer is lost and the follow-up status poll fails, so the turn fails
    # after a real start. The ledger row is present: nothing may settle as
    # never-started.
    D proxy x '[{"path":":start","action":"fail-forward","status":503,"ms":0,"times":1},{"pathRe":"/executions/[^/:%]+$","method":"GET","action":"status","status":503,"delayMs":4000,"body":{"code":"runtime_broker_unavailable","error":"rig injected"}}]' | grep RESULT
    bg_fail $C 'echo STARTED TOKEN; touch /tmp/pr14021-side-effect-TOKEN; sleep TOKEN'
    D proxy x '[]' | grep RESULT
    observe $C after-turn
    log "side-effect file present? $(ls /tmp/pr14021-side-effect-* 2>/dev/null | wc -l)"
    D plog $C broker | grep RESULT
    D plog $C store | grep RESULT
    ;;
  c3-inflight)
    # The start request is still in flight when the turn gives up: every
    # :start answers 503 to the Harness but reaches the Broker DELAY ms later;
    # the Harness's cancel is lost (503). Nothing else is faulted.
    DELAY=${DELAY:-20000}
    D proxy x "[{\"path\":\":start\",\"action\":\"fail-forward\",\"status\":503,\"ms\":$DELAY},{\"path\":\":cancel\",\"action\":\"status\",\"status\":503,\"body\":{\"code\":\"runtime_broker_unavailable\",\"error\":\"rig injected\"}}]" | grep RESULT
    bg_fail $C 'echo LATE-START TOKEN; touch /tmp/pr14021-side-effect-TOKEN; sleep TOKEN'
    observe $C after-turn
    log "waiting for the held :start requests to reach the Broker ($DELAY ms after each attempt)"
    sleep $(( DELAY / 1000 + 10 ))
    D wait-proc $C 20 | grep RESULT
    observe $C after-late-start
    log "side-effect file present? $(ls /tmp/pr14021-side-effect-* 2>/dev/null | wc -l)"
    D proxy x '[]' | grep RESULT
    D plog $C broker | grep RESULT
    D plog $C store | grep RESULT
    ;;
  c3b-inflight-cancel-ok)
    # Same in-flight start, but the cancel reaches the Broker.
    DELAY=${DELAY:-20000}
    D proxy x "[{\"path\":\":start\",\"action\":\"fail-forward\",\"status\":503,\"ms\":$DELAY}]" | grep RESULT
    bg_fail $C 'echo LATE-START TOKEN; touch /tmp/pr14021-side-effect-TOKEN; sleep TOKEN'
    observe $C after-turn
    sleep $(( DELAY / 1000 + 10 ))
    D wait-proc $C 20 | grep RESULT
    observe $C after-late-start
    log "side-effect file present? $(ls /tmp/pr14021-side-effect-* 2>/dev/null | wc -l)"
    D proxy x '[]' | grep RESULT
    D plog $C broker | grep RESULT
    D plog $C store | grep RESULT
    ;;
  c4-window)
    # Residual window: the in-flight start of c3 arrives ~0.5 s after the
    # :process probe, while the store commit of the never-started settlement
    # is slow (the one commit after close_not_started takes +3 s).
    export STORE_VIA_PROXY=1
    DELAY=${DELAY:-3600}
    D proxy x "[{\"path\":\":start\",\"action\":\"fail-forward\",\"status\":503,\"ms\":$DELAY},{\"path\":\":cancel\",\"action\":\"status\",\"status\":503,\"body\":{\"code\":\"runtime_broker_unavailable\",\"error\":\"rig injected\"}}]" | grep RESULT
    D sproxy x '[{"pathRe":"transactions:commit","action":"delay","ms":3000,"times":1,"armedBy":"close_not_started"}]' | grep RESULT
    bg_fail $C 'echo LATE-START TOKEN; touch /tmp/pr14021-side-effect-TOKEN; sleep TOKEN'
    observe $C after-turn
    sleep 12
    D wait-proc $C 15 | grep RESULT
    observe $C after-late-start
    log "side-effect file present? $(ls /tmp/pr14021-side-effect-* 2>/dev/null | wc -l)"
    D proxy x '[]' | grep RESULT; D sproxy x '[]' | grep RESULT
    D plog $C broker | grep RESULT
    D plog $C store | grep RESULT
    ;;
  *) log "unknown scenario $S"; exit 2 ;;
esac
stderr_lines
REC=$(grep '\[RESULT\] snap' "$OUT/$C/observations.log" | tail -1 | sed 's/.*"record"://' | cut -c1-200)
echo "$(date +%T) $TAG | $REC" | tee -a "$OUT/summary.log"
# rig hygiene: stop leftover token processes of this case (by PID, from /proc)
for st in "$OUT/$C.state.json" "$OUT/$C-hold.state.json"; do
  [ -f "$st" ] || continue
  tok=$(sed -n 's/.*"token": "\([0-9]*\)".*/\1/p' "$st")
  [ -n "$tok" ] || continue
  for p in $(grep -l "$tok" /proc/[0-9]*/cmdline 2>/dev/null | cut -d/ -f3); do
    grep -q -a 'driver.mjs\|scen.sh' /proc/$p/cmdline 2>/dev/null || kill "$p" 2>/dev/null
  done
done
rm -f /tmp/pr14021-side-effect-*
log "== $TAG done"
