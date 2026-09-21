#!/bin/bash
# Two broker JVMs, one MySQL 8.4 server (UTC). A uses the plain URL; B's pool forces the
# session time zone (a documented Connector/J setup).
. /root/verify/pr12390-harness/env.sh
A="$MY"
B="$MY?connectionTimeZone=Asia/Shanghai&forceConnectionTimeZoneToSession=true"
P=com.alibaba.qwen.code.runtimebroker.TzProbe
K=$1
c() { printf '\033[1;36m%s\033[0m\n' "$*"; }
run() { java -cp $CP $P "$@" 2>&1 | grep -v Picked; }
c "### Scenario 1 - live lease is taken over (mutual exclusion lost)"
c "\$ broker A (session UTC): claim a 30-minute lease"
run claim "$A" s1-$K owner-A 1800
c "\$ broker B (session +08:00), 1 second later: claim the same binding"
run claim "$B" s1-$K owner-B 1800
c "\$ broker A: renew the lease it was granted a moment ago"
run renew "$A" s1-$K owner-A 1 1800
echo
c "### Scenario 2 - expired lease cannot be taken over (liveness lost)"
c "\$ broker B (session +08:00): claim a 3-second lease, then 'crash'"
run claim "$B" s2-$K owner-B 3
c "\$ sleep 6   # lease expired 3 seconds ago in real time"
sleep 6
c "\$ broker A (session UTC): take over the expired lease"
run claim "$A" s2-$K owner-A 1800
echo
c "### Control - both brokers on the plain URL"
run claim "$A" s3-$K owner-A 1800
run claim "$A" s3-$K owner-B 1800
