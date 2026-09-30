#!/bin/bash
MY="/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -h127.0.0.1 -P23099 -uroot -prig13099 -B -N rig2"
SID=9743883b-900b-4f33-a146-bb02c84611c8
echo "now(db)=$($MY -e 'SELECT NOW(6)' 2>/dev/null)"
echo "record_encoding: $($MY -e "SELECT DISTINCT record_encoding FROM qwen_managed_session_journal_tx WHERE session_id='$SID'" 2>/dev/null | tr '\n' ' ')"
echo "--- tx carrying turn.settled:"
$MY -e "SELECT journal_revision, operation, created_at, SUBSTRING(CONVERT(record_bytes USING utf8mb4), LOCATE('turn.settled', CONVERT(record_bytes USING utf8mb4)), 140) FROM qwen_managed_session_journal_tx WHERE session_id='$SID' AND CONVERT(record_bytes USING utf8mb4) LIKE '%turn.settled%'" 2>/dev/null | cut -c1-330
echo "--- operations by kind:"
$MY -e "SELECT operation, COUNT(*), MIN(created_at), MAX(created_at) FROM qwen_managed_session_journal_tx WHERE session_id='$SID' GROUP BY operation" 2>/dev/null
