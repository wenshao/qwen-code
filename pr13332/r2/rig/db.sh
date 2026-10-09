#!/bin/bash
# Private MySQL 8.4.7 for the rig: port 33332, socket and datadir under the rig.
set -euo pipefail
R=/Users/wenshao/git/pr13332-rig
B=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin
D=$R/mysql-data
if [ ! -d $D ]; then
  $B/mysqld --no-defaults --initialize-insecure --datadir=$D --log-error=$R/logs/mysql-init.log
fi
$B/mysqld --no-defaults --datadir=$D --port=33332 --bind-address=127.0.0.1 \
  --socket=$R/mysql.sock --mysqlx=OFF --log-error=$R/logs/mysql.log \
  --pid-file=$R/mysql.pid --disable-log-bin > /dev/null 2>&1 &
for i in $(seq 1 90); do
  $B/mysqladmin --no-defaults -uroot --socket=$R/mysql.sock ping >/dev/null 2>&1 && break; sleep 1
done
$B/mysql --no-defaults -uroot --socket=$R/mysql.sock -e "SELECT VERSION();"
