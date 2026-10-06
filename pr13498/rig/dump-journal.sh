#!/bin/bash
# usage: dump-journal.sh <kept tmp dir> <out.json>
set -euo pipefail
dir="$1"; out="$2"
M=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin
sock=/Users/wenshao/git/pr13498-rig/t/dump.sock
"$M/mysqld" --no-defaults --datadir="$dir/mysql-data" --skip-networking --socket="$sock" --mysqlx=OFF --skip-log-bin --pid-file=/Users/wenshao/git/pr13498-rig/t/dump.pid --log-error=/Users/wenshao/git/pr13498-rig/t/dump-err.log &
pid=$!
for i in $(seq 1 60); do "$M/mysqladmin" --socket="$sock" -uroot ping >/dev/null 2>&1 && break; sleep 0.5; done
q() { "$M/mysql" --socket="$sock" -uroot --batch --skip-column-names --raw qwen_managed_agent -e "$1"; }
{
echo '{"tx":['
q "SELECT JSON_OBJECT('tenantId',tenant_id,'workspaceId',workspace_id,'sessionId',session_id,'journalRevision',journal_revision,'operation',LEFT(operation,64),'firstSequence',first_sequence,'lastSequence',last_sequence,'eventCount',event_count,'eventsDigest',events_digest,'recordEncoding',record_encoding,'recordDigest',record_digest,'createdAt',DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f'),'recordHex',HEX(record_bytes)) FROM qwen_managed_session_journal_tx ORDER BY tenant_id, session_id, journal_revision" | paste -sd, -
echo '],"head":['
q "SELECT JSON_OBJECT('tenantId',tenant_id,'workspaceId',workspace_id,'sessionId',session_id,'state',state,'committedSequence',committed_sequence,'journalRevision',journal_revision) FROM qwen_managed_session_journal_head" | paste -sd, -
echo ']}'
} > "$out"
kill "$pid"; wait "$pid" 2>/dev/null || true
echo "dumped $(python3 -c "import json;d=json.load(open('$out'));print(len(d['tx']),'tx',len(d['head']),'heads')")"
