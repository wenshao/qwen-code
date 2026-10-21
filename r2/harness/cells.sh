#!/usr/bin/env bash
# Real-kernel cells for qwen-code PR 15035 (fast-tier lock priority).
# usage: ARM=head|base HELPER=/path/to/sdk-java-lock.sh CELL=<name> bash cells.sh
set -uo pipefail

ARM=${ARM:?}
HELPER=${HELPER:?}
CELL=${CELL:?}
OUT=${OUT:?}
HARNESS_DIR=$(cd "$(dirname "$0")" && pwd)
export HELPER OUT HARNESS_DIR

say() { printf '%s\n' "$*" >>"${OUT}"; }
ts() { date -u +%H:%M:%S.%3N; }
fresh_home() { mktemp -d /tmp/lockcell.XXXXXX; }

# base has no tier argument at all; head takes fast|normal.
tier_of() {
  if [[ ${ARM} == base ]]; then printf '%s' '-'; else printf '%s' "$1"; fi
}

spawn_waiter() { # home label budget tier hold [extra-env]
  local home=$1 label=$2 budget=$3 tier=$4 hold=$5
  HOME="${home}" OUT="${OUT}" \
    SDK_JAVA_LOCK_PROMOTE_AFTER="${PROMOTE_AFTER:-}" \
    bash "${HARNESS_DIR}/waiter.sh" "${label}" "${budget}" "${tier}" "${hold}" \
    >>"${OUT}.${label}.stdout" 2>&1 &
  LAST_PID=$!
}

spawn_holder() { # home seconds
  HOME=$1 OUT="${OUT}" bash "${HARNESS_DIR}/holder.sh" "$2" \
    >>"${OUT}.holder.stdout" 2>&1 &
  HOLDER_PID=$!
}

served_order() { grep ' ACQ ' "${OUT}" 2>/dev/null | awk '{print $1}' | paste -sd' ' -; }

case ${CELL} in
c1_order)
  home=$(fresh_home)
  say "cell=c1_order arm=${ARM} home=${home}"
  spawn_holder "${home}" 8
  sleep 0.5
  spawn_waiter "${home}" N1 60 "$(tier_of normal)" 0.3; sleep 0.5
  spawn_waiter "${home}" N2 60 "$(tier_of normal)" 0.3; sleep 0.5
  spawn_waiter "${home}" F3 60 "$(tier_of fast)" 0.3; sleep 0.5
  spawn_waiter "${home}" N4 60 "$(tier_of normal)" 0.3; sleep 0.5
  spawn_waiter "${home}" F5 60 "$(tier_of fast)" 0.3; sleep 0.5
  spawn_waiter "${home}" F6 60 "$(tier_of fast)" 0.3
  wait
  say "c1 served_order=$(served_order)"
  say "c1 queue_left=$(ls -A "${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue" | tr '\n' ' ')"
  ;;

c2_latency)
  MAIN_OUT=${OUT}
  for i in 1 2 3; do
    home=$(fresh_home)
    OUT="${MAIN_OUT}.iter${i}"
    : >"${OUT}"
    say "cell=c2_latency iter=${i} arm=${ARM} home=${home}"
    spawn_holder "${home}" 12
    sleep 0.5
    spawn_waiter "${home}" N1 90 "$(tier_of normal)" 2; sleep 0.5
    spawn_waiter "${home}" N2 90 "$(tier_of normal)" 2; sleep 0.5
    spawn_waiter "${home}" N3 90 "$(tier_of normal)" 2; sleep 0.5
    spawn_waiter "${home}" N4 90 "$(tier_of normal)" 2; sleep 0.5
    spawn_waiter "${home}" FAST 90 "$(tier_of fast)" 0.2
    wait
    fast_ms=$(grep '^FAST ACQ ' "${OUT}" | tail -1 | sed -n 's/.*waited_ms=\([0-9]*\).*/\1/p')
    say "c2 iter=${i} fast_wait_ms=${fast_ms}"
    say "c2 iter=${i} served_order=$(served_order)"
  done
  OUT=${MAIN_OUT}
  ;;

c3_promote)
  home=$(fresh_home)
  queue="${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue"
  say "cell=c3_promote arm=${ARM} home=${home} threshold=5s shape=fast-arrives-after-promotion"
  spawn_holder "${home}" 30
  sleep 0.5
  spawn_waiter "${home}" N1 90 "$(tier_of normal)" 0.3
  sleep 1.5
  PROMOTE_AFTER=5 spawn_waiter "${home}" N2 90 "$(tier_of normal)" 0.3
  for _ in $(seq 1 30); do
    ls "${queue}" | grep -q '^0-0000000002-' && break
    sleep 0.5
  done
  say "c3 tickets_after_promotion=$(ls -A "${queue}" | tr '\n' ' ')"
  say "c3 promote_line=$(grep -h 'Promoted' "${OUT}".*.stdout | head -1)"
  spawn_waiter "${home}" F3 90 "$(tier_of fast)" 0.3
  wait
  say "c3 served_order=$(served_order)"
  say "c3 queue_left=$(ls -A "${queue}" | tr '\n' ' ')"
  ;;

c3b_fast_before_promotion)
  home=$(fresh_home)
  queue="${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue"
  say "cell=c3b_fast_before_promotion arm=${ARM} home=${home} threshold=5s shape=fast-arrives-before-promotion"
  spawn_holder "${home}" 30
  sleep 0.5
  spawn_waiter "${home}" N1 90 "$(tier_of normal)" 0.3
  sleep 1.5
  PROMOTE_AFTER=5 spawn_waiter "${home}" N2 90 "$(tier_of normal)" 0.3
  sleep 1
  spawn_waiter "${home}" F3 90 "$(tier_of fast)" 0.3
  sleep 8
  say "c3b tickets_after_promotion=$(ls -A "${queue}" | tr '\n' ' ')"
  wait
  say "c3b served_order=$(served_order)"
  say "c3b promote_line=$(grep -h 'Promoted' "${OUT}".*.stdout | head -1)"
  say "c3b queue_left=$(ls -A "${queue}" | tr '\n' ' ')"
  ;;

c4_keepalive)
  home=$(fresh_home)
  queue="${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue"
  say "cell=c4_keepalive arm=${ARM} home=${home}"
  spawn_holder "${home}" 45
  sleep 0.5
  spawn_waiter "${home}" HEAD 120 "$(tier_of fast)" 0.3
  HEAD_PID=${LAST_PID}
  sleep 2.5
  ticket=$(ls "${queue}" | grep -v '^\.seq$' | head -1)
  say "c4 head_pid=${HEAD_PID} ticket=${ticket}"
  touch -d '2 hours ago' "${queue}/${ticket}"
  age=$(($(date +%s) - $(stat -c %Y "${queue}/${ticket}")))
  say "c4 ticket_age_before=${age}s"
  # Production never sees a 2h-old head ticket: wait for the keepalive's next
  # touch so the cell measures the steady state, not the refresh window itself.
  for _ in $(seq 1 20); do
    age=$(($(date +%s) - $(stat -c %Y "${queue}/${ticket}")))
    ((age < 10)) && break
    sleep 0.5
  done
  say "c4 ticket_age_after_refresh=${age}s"
  spawn_waiter "${home}" WAITER 120 "$(tier_of normal)" 0.3
  sleep 3.5
  say "c4 ticket_exists_at_t6=$( [[ -e ${queue}/${ticket} ]] && echo yes || echo no )"
  say "c4 ticket_age_at_t6=$(( $(date +%s) - $(stat -c %Y "${queue}/${ticket}" 2>/dev/null || echo 0) ))s"
  kids=$(pgrep -P "${HEAD_PID}" | tr '\n' ' ')
  say "c4 keepalive_children_of_head=${kids:-none}"
  for k in ${kids}; do
    say "c4 child ${k} fds=$(ls -l /proc/${k}/fd 2>/dev/null | grep -c 'sdk-java-tests.lock') lock_fds"
    say "c4 child ${k} cpu=$(ps -o times= -p ${k} 2>/dev/null | tr -d ' ')s"
  done
  wait
  say "c4 served_order=$(served_order)"
  say "c4 queue_left=$(ls -A "${queue}" | tr '\n' ' ')"
  sleep 3
  say "c4 keepalive_after_done=$(pgrep -P "${HEAD_PID}" 2>/dev/null | tr '\n' ' ' || true)"
  say "c4 head_children_after_done=$(ps --ppid "${HEAD_PID}" -o pid= 2>/dev/null | tr '\n' ' ' || true)"
  ;;

c5_reap_ab)
  home=$(fresh_home)
  queue="${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue"
  say "cell=c5_reap_ab arm=${ARM} home=${home}"
  spawn_holder "${home}" 60
  sleep 0.5
  spawn_waiter "${home}" HEAD 120 "$(tier_of fast)" 0.3
  HEAD_PID=${LAST_PID}
  sleep 2.5
  ticket=$(ls "${queue}" | grep -v '^\.seq$' | head -1)
  touch -d '2 hours ago' "${queue}/${ticket}"
  say "c5 parked_head_ticket=${ticket} backdated_age=$(($(date +%s) - $(stat -c %Y "${queue}/${ticket}")))s"
  for _ in $(seq 1 20); do
    age=$(($(date +%s) - $(stat -c %Y "${queue}/${ticket}")))
    ((age < 10)) && break
    sleep 0.5
  done
  say "c5 age_after_refresh=${age}s"
  spawn_waiter "${home}" WAITER 120 "$(tier_of normal)" 0.3
  sleep 5
  say "c5 waiter_looped_twice head_ticket_present=$( [[ -e ${queue}/${ticket} ]] && echo yes || echo no )"
  say "c5 head_alive=$(kill -0 "${HEAD_PID}" 2>/dev/null && echo yes || echo no)"
  say "c5 ticket_age_now=$(( $(date +%s) - $(stat -c %Y "${queue}/${ticket}" 2>/dev/null || echo $(($(date +%s) - 99999)) ) ))s"
  wait
  say "c5 served_order=$(served_order)"
  say "c5 queue_left=$(ls -A "${queue}" | tr '\n' ' ')"
  ;;

c6_kill_head)
  home=$(fresh_home)
  queue="${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue"
  say "cell=c6_kill_head arm=${ARM} home=${home}"
  spawn_holder "${home}" 60
  sleep 0.5
  spawn_waiter "${home}" HEAD 120 "$(tier_of fast)" 0.3
  HEAD_PID=${LAST_PID}
  sleep 3.5
  ticket=$(ls "${queue}" | grep -v '^\.seq$' | head -1)
  say "c6 killing parked head pid=${HEAD_PID} ticket=${ticket}"
  kill -9 "${HEAD_PID}" 2>/dev/null
  wait "${HEAD_PID}" 2>/dev/null
  sleep 1
  say "c6 keepalive_procs_t+1=$(ps -eo args= | grep -c '[w]aiter.sh HEAD')"
  sleep 2
  say "c6 tickets_t+3=$(ls -A "${queue}" | tr '\n' ' ')"
  spawn_waiter "${home}" WAITER 120 "$(tier_of normal)" 0.3
  sleep 2
  say "c6 tickets_t+5=$(ls -A "${queue}" | tr '\n' ' ')"
  sleep 12
  say "c6 tickets_t+17=$(ls -A "${queue}" | tr '\n' ' ')"
  wait
  say "c6 served_order=$(served_order)"
  say "c6 queue_left=$(ls -A "${queue}" | tr '\n' ' ')"
  ;;

c7_touch_c)
  home=$(fresh_home)
  queue="${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue"
  say "cell=c7_touch_c arm=${ARM} home=${home}"
  spawn_holder "${home}" 45
  sleep 0.5
  spawn_waiter "${home}" HEAD 120 "$(tier_of fast)" 0.3
  sleep 3.5
  ticket=$(ls "${queue}" | grep -v '^\.seq$' | head -1)
  rm -f "${queue}/${ticket}"
  say "c7 deleted ${ticket} while head parked"
  sleep 3
  say "c7 ticket_recreated_t+3=$( [[ -e ${queue}/${ticket} ]] && echo yes || echo no )"
  sleep 4
  say "c7 ticket_recreated_t+7=$( [[ -e ${queue}/${ticket} ]] && echo yes || echo no )"
  wait
  say "c7 served_order=$(served_order)"
  say "c7 queue_left=$(ls -A "${queue}" | tr '\n' ' ')"
  ;;

c8_timeout)
  home=$(fresh_home)
  queue="${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue"
  mkdir -p "${queue}"
  printf '1\n' >"${queue}/.seq"
  if [[ ${ARM} == base ]]; then
    foreign="0000000002-$$"
  else
    foreign="1-0000000002-$$"
  fi
  : >"${queue}/${foreign}"
  say "cell=c8_timeout arm=${ARM} home=${home} foreign_head=${foreign}"
  HOME="${home}" OUT="${OUT}" bash "${HARNESS_DIR}/waiter.sh" ME 60 \
    "$(tier_of normal)" 0.2 >>"${OUT}.ME.stdout" 2>&1
  say "c8 rc=$?"
  say "c8 stderr_or_stdout_error=$(grep -h 'not acquired within' "${OUT}.ME.stdout" | head -1)"
  say "c8 queue_left=$(ls -A "${queue}" | tr '\n' ' ')"
  ;;

c9_stress)
  home=$(fresh_home)
  export CS_DIR="${home}/cs"
  mkdir -p "${CS_DIR}"
  say "cell=c9_stress arm=${ARM} home=${home} procs=24"
  spawn_holder "${home}" 3
  sleep 0.3
  i=0
  while ((i < 24)); do
    i=$((i + 1))
    if ((i % 3 == 0)); then
      class=fast
    else
      class=normal
    fi
    spawn_waiter "${home}" "P${i}" 240 "$(tier_of ${class})" 0.3
    sleep 0.15
  done
  wait
  say "c9 overlaps=$(grep -c OVERLAP "${CS_DIR}/ledger" 2>/dev/null || true)"
  say "c9 entries=$(grep -c 'CS enter' "${CS_DIR}/ledger" 2>/dev/null || true)"
  say "c9 fails=$(grep -c ' FAIL ' "${OUT}" || true)"
  say "c9 served_order=$(served_order)"
  say "c9 queue_left=$(ls -A "${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue" | tr '\n' ' ')"
  say "c9 leftover_keepalives=$(ps -eo args= | grep -c '[w]aiter.sh')"
  ;;

c10_wiring)
  home=$(fresh_home)
  queue="${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue"
  say "cell=c10_wiring arm=${ARM} home=${home}"
  spawn_holder "${home}" 12
  sleep 0.5
  spawn_waiter "${home}" T_FAST 60 "$(tier_of fast)" 0.3; sleep 0.4
  spawn_waiter "${home}" T_NORMAL 60 "$(tier_of normal)" 0.3; sleep 0.4
  HOME="${home}" OUT="${OUT}" bash "${HARNESS_DIR}/waiter.sh" T_EMPTY 60 "" 0.3 \
    >>"${OUT}.T_EMPTY.stdout" 2>&1 &
  sleep 2
  say "c10 tickets=$(ls -A "${queue}" | grep -v '^\.seq$' | sort | tr '\n' ' ')"
  say "c10 waiting_lines=$(grep -h 'Waiting for the sdk-java host lock' "${OUT}".*.stdout | sed 's/^/    /' | paste -sd'|' -)"
  wait
  say "c10 served_order=$(served_order)"
  ;;
c12_keepalive_fds)
  home=$(fresh_home)
  queue="${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue"
  say "cell=c12_keepalive_fds arm=${ARM} home=${home}"
  spawn_holder "${home}" 20
  sleep 0.5
  spawn_waiter "${home}" HEAD 90 "$(tier_of fast)" 0.3
  HEAD_PID=${LAST_PID}
  sleep 4
  say "c12 head_pid=${HEAD_PID} head_fd9=$(readlink /proc/${HEAD_PID}/fd/9 2>/dev/null)"
  for k in $(pgrep -P "${HEAD_PID}"); do
    say "c12 child=${k} cmd=$(tr '\0' ' ' <"/proc/${k}/cmdline")"
    say "c12 child=${k} fd9=$(readlink /proc/${k}/fd/9 2>/dev/null || echo closed)"
    say "c12 child=${k} open_fds=$(ls /proc/${k}/fd 2>/dev/null | tr '\n' ',')"
    say "c12 child=${k} lock_refs=$(ls -l /proc/${k}/fd 2>/dev/null | grep -c 'sdk-java-tests.lock')"
  done
  wait
  say "c12 served_order=$(served_order)"
  ;;
*)
  echo "unknown cell ${CELL}" >&2
  exit 2
  ;;
esac
say "cell=${CELL} done arm=${ARM}"