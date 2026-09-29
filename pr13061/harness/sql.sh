#!/bin/bash
# usage: sql.sh <mysql|mariadb|mysqlci> <db> "<sql>"
case $1 in mysql) P=13061;; mariadb) P=13062;; mysqlci) P=13063;; esac
<home>/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -prig13061 -h127.0.0.1 -P$P "$2" -e "$3" 2>&1 | grep -v "Using a password"
