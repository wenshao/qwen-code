#!/bin/bash
exec /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql --protocol=tcp -h127.0.0.1 -P23918 -uroot "${DB:-mysql}" "$@"
