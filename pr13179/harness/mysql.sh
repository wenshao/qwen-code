#!/bin/bash
# VERIFICATION RIG ONLY: private MySQL 8.4.7 for PR #13179.  usage: mysql.sh start|stop
. /Users/wenshao/pr13179-rig/rig.env
M=$RIG/mysql
case "$1" in
  start)
    nohup $MYSQLD --defaults-file=$M/my.cnf > $M/mysqld.out 2>&1 &
    for i in $(seq 1 120); do $MYSQL -h127.0.0.1 -P$DBPORT -uroot -p$DBPASS -e 'select 1' >/dev/null 2>&1 && break; $MYSQL -h127.0.0.1 -P$DBPORT -uroot -e 'select 1' >/dev/null 2>&1 && break; sleep 1; done
    echo "mysqld pid=$(cat $M/mysqld.pid 2>/dev/null)";;
  stop) p=$(cat $M/mysqld.pid); kill $p; for i in $(seq 1 120); do kill -0 $p 2>/dev/null || break; sleep 0.5; done; echo "stopped mysqld pid=$p" ;;
esac
