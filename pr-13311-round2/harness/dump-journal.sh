#!/bin/bash
# usage: dump-journal.sh <kept-tmp-dir> <out.tsv>
set -u
D="$1"; OUT="$2"
B=/root/verify/pr13311/bin
S=/root/verify/pr13311/scratch
SOCK=$S/d$$.sock
"$B/mysqld" --no-defaults --user=root --datadir="$D/mysql-data" --socket="$SOCK" --skip-networking --mysqlx=0 --pid-file=$S/d$$.pid --log-error=$S/d$$.err >/dev/null 2>&1 &
MPID=$!
for i in $(seq 1 60); do [ -S "$SOCK" ] && "$B/mysqladmin" --no-defaults -uroot --socket="$SOCK" ping >/dev/null 2>&1 && break; sleep 0.5; done
"$B/mysql" --no-defaults -uroot --socket="$SOCK" -N -B qwen_managed_agent -e "SELECT tenant_id, workspace_id, session_id, journal_revision, activation_epoch, record_encoding, HEX(record_bytes) FROM qwen_managed_session_journal_tx ORDER BY session_id, journal_revision" > "$OUT"
rc=$?
"$B/mysqladmin" --no-defaults -uroot --socket="$SOCK" shutdown >/dev/null 2>&1
wait $MPID 2>/dev/null
echo "dump rc=$rc rows=$(wc -l < "$OUT") $(basename $OUT)"
