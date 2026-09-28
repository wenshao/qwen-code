#!/bin/bash
# usage: up.sh <jarArm> <workerWT> [extra spring args]
R=$(cd $(dirname $0); pwd)
ARM=$1; WTW=$2; shift 2
pkill -f "ExTap 15894"; pkill -f "server.port=18894"; sleep 2
cd $R && (JAR_ARM=$ARM WT=$WTW STORAGES="$(cat $R/run/storages.txt)" JVM_EXTRA="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=127.0.0.1:15894 ${JVM_MORE}" nohup ./spring.sh ${DB:-o2a} 18894 19894 --logging.level.org.springframework.web.servlet.mvc.method.annotation.ExceptionHandlerExceptionResolver=DEBUG "$@" > $R/run/spring-${DB:-o2a}.log 2>&1 &)
for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18894/actuator/health 2>/dev/null | grep -q 200 && break; sleep 1; done
(nohup ~/Install/jdk21/bin/java -cp $R/jdi ExTap 15894 > $R/run/extap.log 2>&1 &)
sleep 2; echo "spring up arm=$ARM worker=$WTW: $(curl -s http://127.0.0.1:18894/actuator/health)"
