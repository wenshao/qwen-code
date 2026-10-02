#!/bin/bash
DB=${DB:-o41a}
exec /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -prig13084 -h127.0.0.1 -P${SQLPORT:-23084} "$DB" "$@" 2> >(grep -v "Using a password" >&2)
