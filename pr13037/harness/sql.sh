#!/bin/bash
# usage: DB=<schema> sql.sh [-N -B] -e "..."
exec /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -prig13037 -h127.0.0.1 -P23037 "${DB:-o3c}" "$@" 2> >(grep -v "Using a password" >&2)
