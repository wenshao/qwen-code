#!/bin/bash
# Private native MySQL 8.4.7: port 13347, datadir under the rig, short socket path.
set -euo pipefail
R=/Users/wenshao/git/pr13347-rig
B=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin
D=$R/mysql-data
S=/private/tmp/claude-501/m13347.sock
if [ ! -d $D ]; then
  $B/mysqld --no-defaults --initialize-insecure --datadir=$D --log-error=$R/logs/mysql-init.log
fi
$B/mysqld --no-defaults --datadir=$D --port=13347 --bind-address=127.0.0.1 \
  --socket=$S --mysqlx=OFF --log-error=$R/logs/mysql.log --default-time-zone=+00:00 \
  --pid-file=$R/mysql.pid --skip-log-bin > /dev/null 2>&1 &
for i in $(seq 1 60); do
  $B/mysqladmin --no-defaults -uroot --socket=$S ping >/dev/null 2>&1 && break; sleep 1
done
$B/mysql --no-defaults -uroot --socket=$S -e "CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY 'runtime-broker'; GRANT ALL ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION; ALTER USER 'root'@'localhost' IDENTIFIED BY 'runtime-broker'; SELECT VERSION();"
