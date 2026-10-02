#!/bin/bash
# usage: q.sh <db> "<sql>"
/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -h127.0.0.1 -P33135 -uroot -prig13135 "$1" -e "$2" 2>&1 | grep -v "Using a password"
