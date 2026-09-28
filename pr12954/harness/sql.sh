#!/bin/bash
# usage: sql.sh <mysql|mariadb|mysqlci> <db> "<sql>"
case $1 in mysql) P=13954;; mariadb) P=13955;; mysqlci) P=13956;; esac
/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -prig12954 -h127.0.0.1 -P$P "$2" -e "$3" 2>&1 | grep -v "Using a password"
