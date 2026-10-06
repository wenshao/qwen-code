    if (inflightFailover) {
      await waitUntil('Workspace model round reached the model', () => (fake?.requests ?? []).some(({ body }) => JSON.stringify(body['messages']).includes(inflightMarker)), 120_000, harness);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      console.log(JSON.stringify({ probe: 'ws-before-crash', turns: runMysql(mysqlPort, `SELECT turn_id, status, IFNULL(error_code,'-'), submission_attempted, IF(harness_event_epoch IS NULL,'no-epoch','epoch') FROM qwen_managed_agent.managed_agent_turn WHERE tenant_id=${sqlString(tenant)} AND session_id=${sqlString(session.id)}`).split('\n'), executions: runMysql(mysqlPort, 'SELECT COUNT(*) FROM qwen_managed_agent.qwen_tool_execution') }));
    } else if (continuationFailover) {
