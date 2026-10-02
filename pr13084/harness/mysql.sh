#!/bin/bash
# VERIFICATION RIG ONLY (PR #13084): dedicated MySQL 8.4.7 on 127.0.0.1:23084, UTC.
export TZ=UTC
B=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64
D=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/rig/mysql-data
if [ ! -d $D ]; then $B/bin/mysqld --no-defaults --initialize-insecure --datadir=$D --basedir=$B > /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/logs/mysqld-init.log 2>&1 || exit 1; fi
mkdir -p /private/tmp/claude-501/p13084
exec $B/bin/mysqld --no-defaults --datadir=$D --basedir=$B --port=23084 --bind-address=127.0.0.1 --socket=/private/tmp/claude-501/p13084/s --mysqlx=OFF --log-error=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/logs/mysqld.err --pid-file=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/rig/run/mysqld.pid --log-bin-trust-function-creators=1 --default-time-zone=+00:00 --max-connections=400 --disable-log-bin
