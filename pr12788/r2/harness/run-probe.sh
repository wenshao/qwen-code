#!/bin/bash
# usage: M2=<repo> run-probe.sh <arm: head|main> <lane: mariadb|mysql|h2> [test filter]
S=${WORKDIR:?set WORKDIR to the scratch directory}
A=$1; L=$2; F=${3:-LeaseClockProbe}
D=$S/$A/packages/sdk-java/rb-probe; OUT=$S/logs/probe-$A.out
DB=probe_${A}_$(date +%H%M%S)
COMMON="-Dtest=$F -Dsurefire.failIfNoSpecifiedTests=false -Djacoco.skip=true -Dprobe.arm=$A -Dprobe.out=$OUT"
case $L in
  mariadb) docker exec pr12788r2-mariadb mariadb -uroot -pruntime-broker -e "CREATE DATABASE $DB"
    EXTRA=("-Dprobe.url=jdbc:mysql://127.0.0.1:23789/$DB?allowPublicKeyRetrieval=true&useSSL=false" -Dprobe.password=runtime-broker -Dprobe.db=mariadb) ;;
  mysql) $HOME/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -h127.0.0.1 -P23788 -e "CREATE DATABASE $DB"
    EXTRA=("-Dprobe.url=jdbc:mysql://127.0.0.1:23788/$DB?allowPublicKeyRetrieval=true&useSSL=false" -Dprobe.db=mysql) ;;
  h2) EXTRA=(-Dprobe.db=h2) ;;
esac
$S/mvn21.sh $D -Pmysql-integration test $COMMON "${EXTRA[@]}" > $S/logs/probe-$A-$L.log 2>&1
echo "$A $L exit=$? $(grep -E 'Tests run:.*Fail' $S/logs/probe-$A-$L.log | tail -1)" >> $S/logs/probe.status
