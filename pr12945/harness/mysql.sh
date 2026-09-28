#!/bin/bash
exec $HOME/Install/mysql-8.4.7-macos15-arm64/bin/mysqld --no-defaults --datadir=$SP/rig/mysql-data --basedir=$HOME/Install/mysql-8.4.7-macos15-arm64 --port=13945 --bind-address=127.0.0.1 --socket=$SP/run/s --mysqlx=OFF --log-error=$SP/logs/mysqld.err --pid-file=$SP/rig/mysqld.pid
