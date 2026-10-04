#!/bin/bash
# R5: corrupt one goal_state envelope's stored bytes (same length) in MariaDB,
# then reopen with the future-slice dist. Usage: r5-corrupt.sh <arm>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
source $S/env22.sh
ARM=$1; [ "$ARM" = pr ] || [ "$ARM" = base ] || exit 2
cd $S/rig
M=(docker --context colima exec pr13345-mariadb mariadb -uroot -prig13345 -N -B rig13345 -e)
ARM=$ARM LOCAL=0 PHASE=write node r3-reopen.mjs > out/r5-$ARM-write.txt 2>&1 || { echo "write failed"; exit 3; }
SID=$(node -e 'console.log(require(process.argv[1]).sessionId)' $S/rig/out/r3-$ARM-http.json)
[ ${#SID} -eq 36 ] || { echo "bad sid"; exit 3; }
echo "sid=$SID"
"${M[@]}" "SELECT 'before', resource_id, byte_length, LENGTH(inline_bytes), SHA2(inline_bytes,256)=sha256, CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='$SID' AND kind='managed-goal_state' AND CAST(inline_bytes AS CHAR) LIKE '%pre-body 2%'"
"${M[@]}" "UPDATE qwen_managed_session_resource SET inline_bytes = CAST(REPLACE(CAST(inline_bytes AS CHAR), 'pre-body 2', 'pre-body X') AS BINARY) WHERE session_id='$SID' AND kind='managed-goal_state' AND CAST(inline_bytes AS CHAR) LIKE '%pre-body 2%'; SELECT 'updated', ROW_COUNT()"
"${M[@]}" "SELECT 'after', resource_id, byte_length, LENGTH(inline_bytes), SHA2(inline_bytes,256)=sha256, CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='$SID' AND kind='managed-goal_state' AND CAST(inline_bytes AS CHAR) LIKE '%pre-body X%'"
ARM=$ARM LOCAL=0 PHASE=reopen DIST=$S/wt-$ARM/packages/core/dist-future/src/managed-runtime node r3-reopen.mjs 2>&1 | grep -E 'reopen\]'
