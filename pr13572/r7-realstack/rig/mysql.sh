#!/bin/bash
# Private MySQL 8.4.7 for the pr13572 rig (port 33572, UTC).
RIG=/Users/wenshao/git/pr13572-rig
B=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin
D=$RIG/mysql-data
case "$1" in
  start)
    if [ ! -d "$D" ]; then "$B/mysqld" --no-defaults --initialize-insecure --datadir="$D" || exit 1; fi
    "$B/mysqld" --no-defaults --datadir="$D" --socket=$RIG/mysql.sock --port=33572 --bind-address=127.0.0.1 --mysqlx=0 \
      --default-time-zone=+00:00 --pid-file=$RIG/mysql.pid --log-error=$RIG/mysql-error.log --disable-log-bin >/dev/null 2>&1 &
    for i in $(seq 60); do "$B/mysqladmin" --protocol=tcp -h127.0.0.1 -P33572 -uroot ping >/dev/null 2>&1 && { echo up; exit 0; }; sleep 1; done; echo FAIL; exit 1;;
  stop) kill "$(cat $RIG/mysql.pid)";;
  sql) shift; "$B/mysql" --protocol=tcp -h127.0.0.1 -P33572 -uroot "$@";;
esac
