#!/bin/bash
# VERIFICATION RIG ONLY: private MySQL 8.4 for PR 13099 (UTC on both sides).
export TZ=UTC
exec /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysqld --no-defaults --datadir=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad/rig/mysql-data --basedir=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64 --port=23099 --bind-address=127.0.0.1 --socket=/private/tmp/claude-501/p13099/s --mysqlx=OFF --log-error=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad/logs/mysqld.err --pid-file=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad/rig/mysqld.pid --log-bin-trust-function-creators=1 --max-connections=300
