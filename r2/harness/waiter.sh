#!/usr/bin/env bash
# One job asking the real helper for the host lock.
# usage: waiter.sh <label> <budget> <tier|-> <hold-seconds>
set -uo pipefail
source "${HELPER}"
label=$1
budget=$2
tier=$3
hold=$4
out=${OUT:?}

t0=$(date +%s%N)
if [[ ${tier} == '-' ]]; then
  sdk_java_lock_acquire "${budget}"
else
  sdk_java_lock_acquire "${budget}" "${tier}"
fi
rc=$?
t1=$(date +%s%N)
waited_ms=$(( (t1 - t0) / 1000000 ))

if ((rc == 0)); then
  printf '%s ACQ at=%s waited_ms=%s\n' "${label}" "$(date -u +%H:%M:%S.%3N)" "${waited_ms}" >>"${out}"
  if [[ -n ${CS_DIR:-} ]]; then
    if mkdir "${CS_DIR}/inuse" 2>/dev/null; then
      echo "CS enter $(date -u +%H:%M:%S.%3N)" >>"${CS_DIR}/ledger"
      sleep 0.05
      echo "CS exit $(date -u +%H:%M:%S.%3N)" >>"${CS_DIR}/ledger"
      rmdir "${CS_DIR}/inuse"
    else
      printf '%s OVERLAP at=%s\n' "${label}" "$(date -u +%H:%M:%S.%3N)" >>"${out}"
      echo "OVERLAP" >>"${CS_DIR}/ledger"
    fi
  fi
  sleep "${hold}"
  printf '%s REL at=%s\n' "${label}" "$(date -u +%H:%M:%S.%3N)" >>"${out}"
else
  printf '%s FAIL at=%s waited_ms=%s rc=%s\n' "${label}" "$(date -u +%H:%M:%S.%3N)" "${waited_ms}" "${rc}" >>"${out}"
fi
exit "${rc}"