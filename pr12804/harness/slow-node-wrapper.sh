#!/bin/sh
# Delays only the managed-runtime-worker start, to model a slow host.
for a in "$@"; do
  if [ "$a" = managed-runtime-worker ]; then
    echo "$(date +%s) delay ${SLOW_WORKER_SECONDS:-9}s pid $$" >> "$SP/slownode/launches.log"
    sleep "${SLOW_WORKER_SECONDS:-9}"
    break
  fi
done
exec "<real node>" "$@"
