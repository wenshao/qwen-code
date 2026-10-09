#!/bin/bash
DB=${DB:-p654xb}
exec /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -prig13654 -h127.0.0.1 -P13654 "$DB" "$@" 2> >(grep -v "Using a password" >&2)
