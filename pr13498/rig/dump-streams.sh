#!/bin/bash
# usage: dump-streams.sh <kept tmp dir> <out.tsv> — both sequence spaces of each Session
set -euo pipefail
dir="$1"; out="$2"
M=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin
sock=/Users/wenshao/git/pr13498-rig/t/dump.sock
"$M/mysqld" --no-defaults --datadir="$dir/mysql-data" --skip-networking --socket="$sock" --mysqlx=OFF --skip-log-bin --pid-file=/Users/wenshao/git/pr13498-rig/t/dump.pid --log-error=/Users/wenshao/git/pr13498-rig/t/dump-err.log &
pid=$!
for i in $(seq 1 60); do "$M/mysqladmin" --socket="$sock" -uroot ping >/dev/null 2>&1 && break; sleep 0.5; done
"$M/mysql" --socket="$sock" -uroot --batch qwen_managed_agent -e "
SELECT 'public_event' AS stream, tenant_id, session_id, sequence_id AS sequence, event_type AS kind_or_type, event_id FROM managed_agent_event
UNION ALL
SELECT 'authoritative_journal', tenant_id, session_id, first_sequence, CONCAT(operation,' (',event_count,' events)'), transaction_id FROM qwen_managed_session_journal_tx WHERE event_count > 0
ORDER BY tenant_id, session_id, sequence, stream" > "$out"
"$M/mysql" --socket="$sock" -uroot --batch --skip-column-names qwen_managed_agent -e "SELECT tenant_id, session_id, last_sequence FROM managed_agent_session" >> "$out.sessions"
kill "$pid"; wait "$pid" 2>/dev/null || true
wc -l "$out"
