#!/bin/bash
# usage: run-probe.sh <arm>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/2f81e323-488e-421e-ab76-882360719f9e/scratchpad
A=$1; D=$S/$A/packages/sdk-java/rb-probe; OUT=$S/logs/probe-$A.out; : > $OUT
COMMON="-Dtest=LeaseClockProbe -Dsurefire.failIfNoSpecifiedTests=false -Djacoco.skip=true -Dprobe.arm=$A -Dprobe.out=$OUT"
$S/mvn21.sh $D -Pmysql-integration clean test $COMMON > $S/logs/probe-$A-h2.log 2>&1; echo "h2 exit=$?" >> $OUT.status
$S/mvn21.sh $D -Pmysql-integration test $COMMON "-Dprobe.url=jdbc:mysql://127.0.0.1:13788/probe_$A?allowPublicKeyRetrieval=true&useSSL=false" > $S/logs/probe-$A-mysql.log 2>&1; echo "mysql exit=$?" >> $OUT.status
$S/mvn21.sh $D -Pmysql-integration test $COMMON "-Dprobe.url=jdbc:mysql://127.0.0.1:13788/probe_${A}_nf?allowPublicKeyRetrieval=true&useSSL=false&sendFractionalSeconds=false" > $S/logs/probe-$A-nofrac.log 2>&1; echo "nofrac exit=$?" >> $OUT.status
