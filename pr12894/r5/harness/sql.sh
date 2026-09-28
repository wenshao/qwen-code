#!/bin/bash
DB=${DB:-o2a}
exec /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -prig12894 -h127.0.0.1 -P13894 "$DB" "$@" 2> >(grep -v "Using a password" >&2)
