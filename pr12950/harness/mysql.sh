#!/bin/bash
exec ~/Install/mysql-8.4.7-macos15-arm64/bin/mysqld --no-defaults --datadir=<rig>/rig/mysql-data --basedir=~/Install/mysql-8.4.7-macos15-arm64 --port=13950 --bind-address=127.0.0.1 --socket=<rig>/… --mysqlx=OFF --log-error=<rig>/logs/mysqld.err --pid-file=<rig>/rig/mysqld.pid
