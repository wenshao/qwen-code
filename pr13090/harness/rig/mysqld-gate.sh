#!/bin/bash
# VERIFICATION RIG ONLY (PR #13090): dedicated MySQL 8.4.7 on 127.0.0.1:33090, UTC.
export TZ=UTC
B=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64
D=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad/rig/mysql-gate
if [ ! -d $D ]; then $B/bin/mysqld --no-defaults --initialize-insecure --datadir=$D --basedir=$B > /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad/logs/mysqld-gate-init.log 2>&1 || exit 1; fi
mkdir -p /private/tmp/claude-501/p33090
exec $B/bin/mysqld --no-defaults --datadir=$D --basedir=$B --port=33090 --bind-address=127.0.0.1 --socket=/private/tmp/claude-501/p33090/s --mysqlx=OFF --log-error=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad/logs/mysqld-gate.err --pid-file=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad/rig/run/mysqld-gate.pid --log-bin-trust-function-creators=1 --default-time-zone=+00:00 --max-connections=400 --disable-log-bin
