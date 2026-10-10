#!/bin/bash
# VERIFICATION RIG ONLY: private mysqld 8.0 for the rig (own datadir/port/socket).
. /root/v13682/rig/rig.env
D=$RIG/mysql; mkdir -p $D
if [ ! -d $D/data ]; then /opt/mysql-8/bin/mysqld --no-defaults --user=root --initialize-insecure --datadir=$D/data > $D/init.log 2>&1 || { cat $D/init.log; exit 1; }; fi
nohup /opt/mysql-8/bin/mysqld --no-defaults --user=root --datadir=$D/data --port=$DBPORT --bind-address=127.0.0.1 --socket=$D/mysql.sock --mysqlx=OFF --disable-log-bin --default-time-zone=+00:00 --pid-file=$D/mysqld.pid --log-error=$D/error.log > /dev/null 2>&1 &
for i in $(seq 1 60); do $MYSQL -h127.0.0.1 -P$DBPORT -uroot -e 'select 1' >/dev/null 2>&1 && break; sleep 1; done
$MYSQL -h127.0.0.1 -P$DBPORT -uroot -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$DBPASS'; CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '$DBPASS'; GRANT ALL ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;" 2>/dev/null
$MYSQL -h127.0.0.1 -P$DBPORT -uroot -p$DBPASS -e 'select version()' 2>/dev/null | tail -1
