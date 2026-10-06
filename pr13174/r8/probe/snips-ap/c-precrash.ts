    if (inflightFailover) {
      let probeAction: Record<string, unknown> | undefined;
      await waitUntil('approval Action requested', async () => {
        const list = (await fetchJson(`${springUrl}/v1/agents/sessions/${session.id}/actions`, { headers: tenantHeaders(tenant) }).catch(() => undefined)) as { data?: Record<string, unknown>[] } | undefined;
        probeAction = list?.data?.[0];
        return probeAction !== undefined;
      }, 120_000, harness);
      probeApprovalAction = probeAction;
      console.log(JSON.stringify({ probe: 'ap-before-crash', action: probeAction, turns: runMysql(mysqlPort, `SELECT turn_id, status, IFNULL(error_code,'-') FROM qwen_managed_agent.managed_agent_turn WHERE tenant_id=${sqlString(tenant)} AND session_id=${sqlString(session.id)}`).split('\n'), executions: runMysql(mysqlPort, 'SELECT COUNT(*) FROM qwen_managed_agent.qwen_tool_execution') }));
    } else if (continuationFailover) {
