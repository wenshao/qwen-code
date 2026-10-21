#!/usr/bin/env bash
# Real 20-minute default threshold (SDK_JAVA_LOCK_PROMOTE_AFTER unset).
# Shape matters: promotion is only reachable for a ticket that is NOT head, so
# this arms a parked head (N1) ahead of the ticket that must promote (N2).
set -uo pipefail
ARM=${ARM:?}
HELPER=${HELPER:?}
OUT=${OUT:?}
HARNESS_DIR=$(cd "$(dirname "$0")" && pwd)
home=$(mktemp -d /tmp/locklong.XXXXXX)
queue="${home}/.cache/qwen-code-ci/sdk-java-tests.lock.queue"
say() { printf '%s\n' "$*" >>"${OUT}"; }
tier() { if [[ ${ARM} == base ]]; then printf '%s' '-'; else printf '%s' "$1"; fi; }
say "cell=c11_default_threshold arm=${ARM} home=${home} start=$(date -u +%H:%M:%S)"
HOME="${home}" OUT="${OUT}" bash "${HARNESS_DIR}/holder.sh" 1250 >>"${OUT}.holder.stdout" 2>&1 &
sleep 1
HOME="${home}" OUT="${OUT}" bash "${HARNESS_DIR}/waiter.sh" N1 1400 "$(tier normal)" 0.3 >>"${OUT}.N1.stdout" 2>&1 &
sleep 2
HOME="${home}" OUT="${OUT}" bash "${HARNESS_DIR}/waiter.sh" N2 1400 "$(tier normal)" 0.3 >>"${OUT}.N2.stdout" 2>&1 &
sleep 1200
say "c11 t+1203 tickets=$(ls -A "${queue}" | tr '\n' ' ')"
say "c11 promote_line=$(grep -h 'Promoted' "${OUT}".*.stdout | head -1)"
HOME="${home}" OUT="${OUT}" bash "${HARNESS_DIR}/waiter.sh" F 300 "$(tier fast)" 0.3 >>"${OUT}.F.stdout" 2>&1 &
sleep 50
say "c11 t+1253 tickets=$(ls -A "${queue}" | tr '\n' ' ')"
wait
say "c11 served_order=$(grep ' ACQ ' "${OUT}" | awk '{print $1}' | paste -sd' ' -)"
say "c11 fast_wait=$(grep ' ACQ ' "${OUT}" | awk '$1=="F"{print $4}')"
say "c11 queue_left=$(ls -A "${queue}" | tr '\n' ' ')"
say "cell=c11_default_threshold done arm=${ARM} end=$(date -u +%H:%M:%S)"