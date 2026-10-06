#!/bin/bash
# VERIFICATION RIG ONLY: the Broker launches workers through this wrapper so each launch and its stderr are kept.
LOGDIR=${RIG_WORKER_LOGS:-/root/verify/pr13166/rig/run/workers}
mkdir -p $LOGDIR
N=$(date +%s)-$$
echo "$(date -u +%FT%TZ) pid=$$ $*" >> $LOGDIR/launches.log
exec /usr/bin/node "$@" 2>> $LOGDIR/worker-$N.err
