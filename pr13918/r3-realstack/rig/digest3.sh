#!/bin/bash
# digest3.sh <tag> — per-schema guard-statement digest for round-3 runs (MySQL 23918) → results/<tag>-guard-digest.tsv
TAG=$1; RIG=/Users/wenshao/pr13918-rig; OUT=$RIG/results/$TAG-guard-digest.tsv
/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql --protocol=tcp -h127.0.0.1 -P${DBPORT:-23918} -uroot --batch -e "
SELECT SCHEMA_NAME AS db, SUM(COUNT_STAR) AS execs, SUM(SUM_ERRORS) AS timed_out, ROUND(MAX(MAX_TIMER_WAIT)/1e12, 2) AS max_wait_s
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME LIKE 'r18\\_%\\_${TAG}\\_%' AND DIGEST_TEXT LIKE 'INSERT INTO \`ma_tenant_guard\`%'
GROUP BY SCHEMA_NAME ORDER BY SCHEMA_NAME" > $OUT
/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql --protocol=tcp -h127.0.0.1 -P${DBPORT:-23918} -uroot --batch -e "SELECT COUNT(*) AS digest_rows FROM performance_schema.events_statements_summary_by_digest"
cat $OUT
