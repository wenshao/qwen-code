#!/bin/bash
# Native MySQL 8.4.7 on a private port/datadir (UTC, like the JVM). usage: mysql.sh init|start|stop|sql "<stmt>"|pid
. /Users/wenshao/pr13095-rig/scripts/env.sh
D=$RIG/mysql; B=$MYSQL_HOME_DIR/bin
case "$1" in
  init)
    mkdir -p $D && $B/mysqld --no-defaults --initialize-insecure --basedir=$MYSQL_HOME_DIR --datadir=$D/data > $D/init.log 2>&1; echo "init exit=$?";;
  start)
    nohup $B/mysqld --no-defaults --basedir=$MYSQL_HOME_DIR --datadir=$D/data --port=$MYSQL_PORT --bind-address=127.0.0.1 \
      --mysqlx=OFF --socket=$D/mysql.sock --pid-file=$D/mysqld.pid --log-error=$D/error.log \
      --default-time-zone=+00:00 --max-connections=400 --general-log=0 --general-log-file=$D/general.log > $D/start.log 2>&1 &
    for i in $(seq 1 60); do $B/mysqladmin --no-defaults -uroot -h127.0.0.1 -P$MYSQL_PORT ping > /dev/null 2>&1 && break; sleep 1; done
    $B/mysql --no-defaults -uroot -h127.0.0.1 -P$MYSQL_PORT -e "ALTER USER 'root'@'localhost' IDENTIFIED BY 'rig13095'; CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY 'rig13095'; GRANT ALL ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;" 2>/dev/null
    $B/mysql --no-defaults -uroot -prig13095 -h127.0.0.1 -P$MYSQL_PORT -N -e "SELECT CONCAT('mysqld ', VERSION(), ' tz=', @@global.time_zone, ' pid=', @@pid_file)" 2>/dev/null;;
  stop) kill "$(cat $D/mysqld.pid)";;
  pid) cat $D/mysqld.pid;;
  sql) shift; $B/mysql --no-defaults -uroot -prig13095 -h127.0.0.1 -P$MYSQL_PORT -N -e "$1" 2>/dev/null;;
esac
