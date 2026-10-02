#!/bin/bash
# usage: [DB=..] [GC=..] [GRACE=..] up.sh <jarArm> [httpPort] [brokerPort] [extra spring args]
R=$(cd $(dirname $0); pwd)
ARM=$1; HTTP=${2:-38094}; BP=${3:-39094}; shift 3 2>/dev/null || shift $#
DB=${DB:-o4a}
LOG=$R/run/spring-$DB-$HTTP.log
[ -f $LOG ] && mv $LOG $LOG.$(date +%H%M%S)
(cd $R && JAR_ARM=$ARM PUB_PORT=${PUB_PORT:-38095} exec nohup ./spring.sh $DB $HTTP $BP "$@") > $LOG 2>&1 < /dev/null &
for i in $(seq 1 180); do curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$HTTP/actuator/health 2>/dev/null | grep -q 200 && break; sleep 1; done
echo "spring arm=$ARM db=$DB port=$HTTP gc=${GC:-true} grace=${GRACE:-10s}: $(curl -s http://127.0.0.1:$HTTP/actuator/health) pid=$(lsof -nP -iTCP:$HTTP -sTCP:LISTEN -t)"
