#!/bin/bash
# Round 4 production-app matrix on the trial-merge classes (arm m4); upgrade from current main (arm main4).
E=/Users/wenshao/pr13554-rig/e2e; L=/Users/wenshao/pr13554-rig/logs/e2e4; mkdir -p $L
cd $E
./e2e1.sh m4 18601 > $L/E2E1-m4.log 2>&1
./cad.sh m4 18641 > $L/CAD-m4.log 2>&1
ARM=m4 ./e2e2.sh > $L/E2E2.log 2>&1
for n in A B C; do kill $(cat $E/run/e2e2-$n.pid) 2>/dev/null; done
ARM=m4 ./e2e3.sh > $L/E2E3.log 2>&1
kill $(cat $E/run/e2e3-C.pid) 2>/dev/null
OLD=main4 NEW=m4 DBH=mysql84 DBHOST=mysql84:3306 ./upgrade.sh > $L/UP-mysql84.log 2>&1
OLD=main4 NEW=m4 DBH=mariadb DBHOST=mariadb:3306 ./upgrade.sh > $L/UP-mariadb.log 2>&1
ARM=m4 ./binlog.sh > $L/BIN.log 2>&1
echo E2E4-DONE > $L/done
