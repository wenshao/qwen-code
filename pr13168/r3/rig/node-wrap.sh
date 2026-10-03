#!/bin/bash
# VERIFICATION RIG ONLY: Broker launches workers through this wrapper so each launch and its stderr are kept.
LOGDIR=${RIG_WORKER_LOGS:-/Users/wenshao/pr13168-r2/run/workers}
mkdir -p $LOGDIR
N=$(date +%s)-$$
echo "$(date -u +%FT%TZ) pid=$$ $*" >> $LOGDIR/launches.log
exec /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node "$@" 2>> $LOGDIR/worker-$N.err
