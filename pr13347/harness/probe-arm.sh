#!/bin/bash
# probe-arm.sh <arm> <port>: tasks probe with the MySQL general log on, then
# the opening-command statements the live store issued.
set -uo pipefail
arm=$1; port=$2
M() { /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql --no-defaults -uroot -pruntime-broker -h127.0.0.1 -P13347 "$@" 2>/dev/null; }
M -e "TRUNCATE mysql.general_log; SET GLOBAL log_output='TABLE'; SET GLOBAL general_log='ON';"
[ "$(M -N -e 'SELECT @@general_log')" = 1 ] || { echo "general log not on"; exit 1; }
NO_PROXY='*' node tasks-probe.mjs http://127.0.0.1:$port $arm results/tasks-probe-$arm.json
M -e "SET GLOBAL general_log='OFF';"
M -N -e "SELECT CONVERT(argument USING utf8mb4) FROM mysql.general_log WHERE CONVERT(argument USING utf8mb4) LIKE 'SELECT COUNT(*) FROM qwen_managed_session_extension_record%operation_hash%'" > results/general-log-opening-$arm.txt
echo "$arm opening statements: $(wc -l < results/general-log-opening-$arm.txt)"
sed -E 's/[0-9a-f]{64}/<h>/g' results/general-log-opening-$arm.txt | sort | uniq -c
