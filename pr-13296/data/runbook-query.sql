SELECT retention_state, gc_blocker, COUNT(*) AS publications,
       SUM(gc_next_at = 0) AS no_delay_publications,
       MIN(NULLIF(gc_next_at, 0)) AS earliest_retry_epoch_ms,
       FROM_UNIXTIME(MIN(NULLIF(gc_next_at, 0)) / 1000) AS earliest_retry_db_time
FROM qwen_tool_publication
WHERE retention_state IN ('RETIRING', 'DELETING')
GROUP BY retention_state, gc_blocker;
