#!/bin/bash
# Run the head arm under READ COMMITTED on both servers, then restore REPEATABLE READ.
P=/Users/wenshao/pr13554-rig/probe4
mysql -hmysql84 -uroot -pverify -e "SET GLOBAL transaction_isolation = 'READ-COMMITTED'" 2>/dev/null
mysql -hmariadb -uroot -pverify -e "SET GLOBAL tx_isolation = 'READ-COMMITTED'" 2>/dev/null
TAG=-rc $P/run-arm.sh head mysql84 inflight,gap,collectorFirst,stress 30
TAG=-rc $P/run-arm.sh head mariadb inflight,gap,collectorFirst,stress 30
mysql -hmysql84 -uroot -pverify -e "SET GLOBAL transaction_isolation = 'REPEATABLE-READ'" 2>/dev/null
mysql -hmariadb -uroot -pverify -e "SET GLOBAL tx_isolation = 'REPEATABLE-READ'" 2>/dev/null
echo "restored: $(mysql -hmysql84 -uroot -pverify -N -e 'select @@global.transaction_isolation' 2>/dev/null) $(mysql -hmariadb -uroot -pverify -N -e 'select @@global.tx_isolation' 2>/dev/null)"
