#!/bin/bash
cd /Users/wenshao/git/pr13974-arms
OUT=results/wake-turn-after-restart.txt
M=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql
{
echo "# Lead journal around the restart (renewActivation rows omitted). gen 2 = restarted Harness."
echo "# commitMessage right after the restart = tool_result answering the interrupted call (head/merge);"
echo "# settleTurn = turn.settled outcome=error for <child>:accept:notify. Nothing else happens until the probe's user input (submitInput)."
for spec in "head-p3a p3aDecisionCommittedContinuationLost pr13974_head_p3a_p3a" "merge-p3a p3aDecisionCommittedContinuationLost pr13974_merge_p3a_p3a" "base-p3w p3wWakeTurnContinuationLost pr13974_base_p3w_p3w"; do
  set -- $spec
  lead=$(python3 -c "import json;print(json.load(open('results/$1/$2.json'))['lead'])")
  echo; echo "== $1 (lead $lead)"
  $M --no-defaults -uroot -h127.0.0.1 -P13974 $3 -e "SELECT journal_revision rev, writer_generation gen, operation, LEFT(command_id,56) command_id, created_at FROM qwen_managed_session_journal_tx WHERE session_id='$lead' AND operation <> 'renewActivation' AND journal_revision >= 25 ORDER BY journal_revision LIMIT 16"
done
echo; echo "== head-p3a-dbg3: the tool_result the restarted Harness wrote (rev 37)"
$M --no-defaults -uroot -h127.0.0.1 -P13974 pr13974_head_p3a_dbg3_p3a -N -e "SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE resource_id='e0607b92-e8a5-42a0-bf4c-836a2220f0c8'"
} > $OUT 2>&1
