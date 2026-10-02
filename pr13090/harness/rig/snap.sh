#!/bin/bash
# usage: DB=.. snap.sh <sessionId>  -> one line per publication
R=$(cd $(dirname $0); pwd)
$R/sql.sh -N -e "SELECT CONCAT(LEFT(publication_id,8),' ',retention_state,' gen=',gc_generation,' owner=',LEFT(IFNULL(gc_owner,'-'),8),' blocker=',IFNULL(gc_blocker,'-'),' cursor=',IF(gc_cursor='','-',gc_cursor),' held=',capture_held_bytes+producer_held_bytes+admission_held_bytes,' used=',capture_used_bytes+producer_used_bytes+admission_used_bytes,' collected=',IFNULL(collected_bytes,'-'),' released=',IFNULL(released_held_bytes,'-'),' next_in_ms=',gc_next_at-(UNIX_TIMESTAMP(NOW(3))*1000)) FROM qwen_tool_publication WHERE session_id='$1' ORDER BY publication_id"
