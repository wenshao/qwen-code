#!/bin/bash
exec /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql --no-defaults -uroot --socket=/Users/wenshao/git/pr13376-rig/mysql.sock "$@"
