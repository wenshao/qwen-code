#!/bin/bash
# In-container boot: MySQL 8.0 (UTC, 127.0.0.1:3306) + the scripted model on 127.0.0.1:18598.
set -u
mkdir -p /var/lib/rigmysql /var/run/mysqld /rig/runs && chown -R mysql:mysql /var/lib/rigmysql /var/run/mysqld
if [ ! -d /var/lib/rigmysql/mysql ]; then mysqld --no-defaults --user=mysql --initialize-insecure --datadir=/var/lib/rigmysql >/rig/runs/mysql-init.log 2>&1; fi
if ! mysqladmin -uroot -h127.0.0.1 -P3306 ping >/dev/null 2>&1; then
  setsid mysqld --no-defaults --user=mysql --datadir=/var/lib/rigmysql --socket=/var/run/mysqld/mysqld.sock --port=3306 --bind-address=127.0.0.1 --mysqlx=0 --default-time-zone=+00:00 --disable-log-bin --log-error=/var/lib/rigmysql/error.log >/dev/null 2>&1 < /dev/null &
fi
for i in $(seq 60); do mysqladmin -uroot -h127.0.0.1 -P3306 ping >/dev/null 2>&1 && break; sleep 1; done; mysqladmin -uroot -h127.0.0.1 -P3306 ping
if ! (exec 3<>/dev/tcp/127.0.0.1/18598) 2>/dev/null; then FAKE_PORT=18598 setsid node /rig/fakemodel7.mjs > /rig/runs/model.log 2>&1 < /dev/null & sleep 2; fi
cat /rig/runs/model.log | head -1
