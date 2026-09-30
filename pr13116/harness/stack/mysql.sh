#!/bin/bash
# VERIFICATION RIG ONLY (PR 13116): private MySQL 8.4.7, UTC. usage: mysql.sh init|start
S=/Users/wenshao/pr13116-rig/stack; B=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64; export TZ=UTC
case $1 in
  init) $B/bin/mysqld --no-defaults --initialize-insecure --datadir=$S/mysql-data --basedir=$B > $S/logs/mysql-init.log 2>&1; echo "init exit=$?";;
  start) exec $B/bin/mysqld --no-defaults --datadir=$S/mysql-data --basedir=$B --port=23116 --bind-address=127.0.0.1 \
    --socket=/private/tmp/claude-501/p13116/s --mysqlx=OFF --log-error=$S/logs/mysqld.err --pid-file=$S/run/mysqld.pid \
    --log-bin-trust-function-creators=1 --max-connections=300 --disable-log-bin --default-time-zone=+00:00;;
esac
