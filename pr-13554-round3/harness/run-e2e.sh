#!/bin/bash
E=/Users/wenshao/pr13554-rig/e2e; L=/Users/wenshao/pr13554-rig/logs/e2e; mkdir -p $L
cd $E
./e2e1.sh head 18601 > $L/E2E1-head.log 2>&1
./e2e1.sh r2 18701 > $L/E2E1-r2.log 2>&1
./cad.sh head 18641 > $L/CAD-head.log 2>&1 &
./cad.sh r2 18741 > $L/CAD-r2.log 2>&1 &
wait
./e2e2.sh > $L/E2E2.log 2>&1
./e2e3.sh > $L/E2E3.log 2>&1
DBH=mysql84 DBHOST=mysql84:3306 ./upgrade.sh > $L/UP-mysql84.log 2>&1
DBH=mariadb DBHOST=mariadb:3306 ./upgrade.sh > $L/UP-mariadb.log 2>&1
echo E2E-ALL-DONE > $L/done
