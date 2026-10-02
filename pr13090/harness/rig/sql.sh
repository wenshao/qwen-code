#!/bin/bash
DB=${DB:-o4a}
exec /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppw13090 -h127.0.0.1 -P33091 "$DB" "$@" 2> >(grep -v "Using a password" >&2)
